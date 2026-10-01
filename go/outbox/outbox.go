// Package outbox is an app's at-least-once outbox: rows written in the same
// transaction as the domain change they announce, drained later by the app's
// cron.
//
// It has no database driver: every write goes through a Querier the app supplies (a pgx
// pool or transaction satisfies it). The safety lives in Postgres — a partial
// unique index on dedupe_key, FOR UPDATE SKIP LOCKED in the claim — so a fake
// Querier in a test proves only the state machine, which is what the tests
// here do.
//
// Rules:
//   - AddTx is ON CONFLICT DO NOTHING on the live dedupe key: identical work
//     already booked is not booked twice, and is not an error.
//   - a handler must be safe to run twice; the queue is at-least-once.
//   - a failing item retries with backoff 1m, 2m, 4m … capped at 30m, and is
//     dead after MaxAttempts; a permanent failure (ErrPermanent) dies at once.
//   - Drain is bounded by a budget and reports what it left.
package outbox

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
)

// DDL is the table. JSONB values are passed as strings (the simple-protocol
// rule).
const DDL = `CREATE TABLE IF NOT EXISTS outbox (
  id           BIGSERIAL PRIMARY KEY,
  kind         TEXT NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}',
  state        TEXT NOT NULL DEFAULT 'pending'
               CHECK (state IN ('pending','running','done','dead')),
  attempt      INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 8,
  run_after    TIMESTAMPTZ NOT NULL DEFAULT now(),
  leased_until TIMESTAMPTZ,
  last_error   TEXT NOT NULL DEFAULT '',
  dedupe_key   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_pickup ON outbox (run_after) WHERE state = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS outbox_dedupe_live
  ON outbox (dedupe_key) WHERE dedupe_key IS NOT NULL AND state IN ('pending','running');`

// Row is one row as a Querier scans it.
type Row interface {
	Scan(dest ...any) error
}

// Querier is the least the outbox needs: a pgx pool or transaction.
type Querier interface {
	Exec(ctx context.Context, sql string, args ...any) (any, error)
	QueryRow(ctx context.Context, sql string, args ...any) Row
}

// Item is one piece of work to book.
type Item struct {
	Kind    string
	Payload any
	// RunAfter is when it becomes claimable. Zero means now.
	RunAfter time.Time
	// DedupeKey collapses this with any other LIVE item carrying the same
	// key. Empty means no deduplication.
	DedupeKey   string
	MaxAttempts int
}

// Job is one claimed item.
type Job struct {
	ID          int64
	Kind        string
	Payload     json.RawMessage
	Attempt     int
	MaxAttempts int
	DedupeKey   string
}

// Handler drains one item. Returning an error retries it until MaxAttempts.
type Handler func(ctx context.Context, j Job) error

// ErrPermanent marks a failure retrying cannot fix; the item dies at once.
var ErrPermanent = errors.New("outbox: permanent failure")

// ErrNoRows is what a Querier returns for an empty QueryRow (pgx's text).
var ErrNoRows = errors.New("no rows in result set")

func isNoRows(err error) bool {
	return errors.Is(err, ErrNoRows) || strings.Contains(err.Error(), "no rows in result set")
}

// Outbox drains items with a clock a test can set.
type Outbox struct {
	Now func() time.Time
}

// New builds one on the wall clock.
func New() *Outbox { return &Outbox{Now: time.Now} }

// AddTx books an item through q — the caller's transaction, so the item
// lands or does not land WITH the row that asked for it. Returns the id, or
// 0 when an identical live item already exists.
func (o *Outbox) AddTx(ctx context.Context, q Querier, it Item) (int64, error) {
	payload, err := json.Marshal(it.Payload)
	if err != nil {
		return 0, fmt.Errorf("outbox: marshal payload: %w", err)
	}
	if it.Payload == nil {
		payload = []byte(`{}`)
	}
	runAfter := it.RunAfter
	if runAfter.IsZero() {
		runAfter = o.now()
	}
	max := it.MaxAttempts
	if max <= 0 {
		max = 8
	}
	var dedupe *string
	if it.DedupeKey != "" {
		dedupe = &it.DedupeKey
	}
	var id int64
	err = q.QueryRow(ctx, `INSERT INTO outbox (kind, payload, run_after, dedupe_key, max_attempts)
		VALUES ($1, $2::jsonb, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING id`,
		it.Kind, string(payload), runAfter.UTC(), dedupe, max).Scan(&id)
	if err != nil && isNoRows(err) {
		return 0, nil
	}
	return id, err
}

// Result is what one Drain did.
type Result struct {
	Claimed, Done, Failed, Dead int
}

// Drain works until nothing is claimable, `max` items are handled, or the
// budget is spent. Items whose lease expired are reclaimed first. Unlike a
// transaction, the pool is what q should be here: each claim commits on its
// own so a crash mid-item leaves it leased, not lost.
func (o *Outbox) Drain(ctx context.Context, q Querier, handlers map[string]Handler, max int, budget time.Duration) (Result, error) {
	var out Result
	deadline := o.now().Add(budget)
	if _, err := q.Exec(ctx, `UPDATE outbox SET state='pending', leased_until=NULL, updated_at=now()
		 WHERE state='running' AND leased_until < $1`, o.now().UTC()); err != nil {
		return out, err
	}
	lease := budget + 2*time.Minute
	if lease < time.Minute {
		lease = time.Minute
	}
	for out.Claimed < max && o.now().Before(deadline) {
		var j Job
		var raw string
		err := q.QueryRow(ctx, `WITH next AS (
			SELECT id FROM outbox WHERE state='pending' AND run_after <= $1
			 ORDER BY run_after, id FOR UPDATE SKIP LOCKED LIMIT 1
		)
		UPDATE outbox SET state='running', leased_until=$2, attempt=outbox.attempt+1, updated_at=now()
		  FROM next WHERE outbox.id = next.id
		RETURNING outbox.id, outbox.kind, outbox.payload::text, outbox.attempt, outbox.max_attempts, coalesce(outbox.dedupe_key,'')`,
			o.now().UTC(), o.now().Add(lease).UTC()).Scan(&j.ID, &j.Kind, &raw, &j.Attempt, &j.MaxAttempts, &j.DedupeKey)
		if err != nil {
			if isNoRows(err) {
				break
			}
			return out, err
		}
		j.Payload = json.RawMessage(raw)
		out.Claimed++
		h, ok := handlers[j.Kind]
		if !ok {
			out.Dead++
			if err := o.mark(ctx, q, j.ID, "dead", "no handler registered for this kind", time.Time{}); err != nil {
				return out, err
			}
			continue
		}
		err = run(ctx, h, j)
		switch {
		case err == nil:
			out.Done++
			err = o.mark(ctx, q, j.ID, "done", "", time.Time{})
		case errors.Is(err, ErrPermanent) || j.Attempt >= j.MaxAttempts:
			out.Dead++
			err = o.mark(ctx, q, j.ID, "dead", err.Error(), time.Time{})
		default:
			out.Failed++
			err = o.mark(ctx, q, j.ID, "pending", err.Error(), o.now().Add(Backoff(j.Attempt)))
		}
		if err != nil {
			return out, err
		}
	}
	return out, nil
}

func run(ctx context.Context, h Handler, j Job) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("handler panicked: %v", r)
		}
	}()
	return h(ctx, j)
}

func (o *Outbox) mark(ctx context.Context, q Querier, id int64, state, lastErr string, runAfter time.Time) error {
	if runAfter.IsZero() {
		_, err := q.Exec(ctx, `UPDATE outbox SET state=$2, last_error=$3, leased_until=NULL, updated_at=now() WHERE id=$1`, id, state, lastErr)
		return err
	}
	_, err := q.Exec(ctx, `UPDATE outbox SET state=$2, last_error=$3, run_after=$4, leased_until=NULL, updated_at=now() WHERE id=$1`,
		id, state, lastErr, runAfter.UTC())
	return err
}

// Backoff is the retry delay after `attempt`: 1m, 2m, 4m, … capped at 30m.
// Capped because an item retrying hourly is indistinguishable from one nobody
// is running.
func Backoff(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	if attempt > 6 {
		// 2^5 minutes is already past the cap; larger exponents would only
		// overflow the Duration.
		return 30 * time.Minute
	}
	d := time.Duration(math.Pow(2, float64(attempt-1))) * time.Minute
	if d > 30*time.Minute {
		d = 30 * time.Minute
	}
	return d
}

func (o *Outbox) now() time.Time {
	if o.Now == nil {
		return time.Now()
	}
	return o.Now()
}
