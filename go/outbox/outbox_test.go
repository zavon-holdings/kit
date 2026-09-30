package outbox

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
)

// table is a fake Querier: enough of Postgres to run the package's four
// statements against an in-memory slice, so the state machine is tested
// without a database. The real safety (partial unique index, SKIP LOCKED)
// is Postgres's, and is what DDL declares.
type row struct {
	id                   int64
	kind, payload, state string
	attempt, maxAttempts int
	runAfter             time.Time
	leasedUntil          *time.Time
	lastError            string
	dedupe               string
}

type table struct {
	mu   sync.Mutex
	rows []*row
	next int64
	fail error
}

type scanRow struct {
	vals []any
	err  error
}

func (r scanRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	for i, d := range dest {
		switch p := d.(type) {
		case *int64:
			*p = r.vals[i].(int64)
		case *string:
			*p = r.vals[i].(string)
		case *int:
			*p = r.vals[i].(int)
		default:
			return fmt.Errorf("scan into %T", d)
		}
	}
	return nil
}

func (t *table) Exec(_ context.Context, sql string, args ...any) (any, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.fail != nil {
		return nil, t.fail
	}
	switch {
	case strings.Contains(sql, "WHERE state='running' AND leased_until <"):
		cut := args[0].(time.Time)
		for _, r := range t.rows {
			if r.state == "running" && r.leasedUntil != nil && r.leasedUntil.Before(cut) {
				r.state, r.leasedUntil = "pending", nil
			}
		}
	case strings.HasPrefix(sql, "UPDATE outbox SET state=$2"):
		for _, r := range t.rows {
			if r.id == args[0].(int64) {
				r.state, r.lastError, r.leasedUntil = args[1].(string), args[2].(string), nil
				if len(args) > 3 {
					r.runAfter = args[3].(time.Time)
				}
			}
		}
	default:
		return nil, fmt.Errorf("unexpected Exec: %s", sql)
	}
	return nil, nil
}

func (t *table) QueryRow(_ context.Context, sql string, args ...any) Row {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.fail != nil {
		return scanRow{err: t.fail}
	}
	switch {
	case strings.HasPrefix(sql, "INSERT INTO outbox"):
		if _, isString := args[1].(string); !isString {
			return scanRow{err: fmt.Errorf("JSONB must be a string, got %T", args[1])}
		}
		dedupe := ""
		if p, _ := args[3].(*string); p != nil {
			dedupe = *p
			for _, r := range t.rows {
				if r.dedupe == dedupe && (r.state == "pending" || r.state == "running") {
					return scanRow{err: ErrNoRows} // ON CONFLICT DO NOTHING → no RETURNING row
				}
			}
		}
		t.next++
		t.rows = append(t.rows, &row{id: t.next, kind: args[0].(string), payload: args[1].(string), state: "pending",
			runAfter: args[2].(time.Time), dedupe: dedupe, maxAttempts: args[4].(int)})
		return scanRow{vals: []any{t.next}}
	case strings.Contains(sql, "FOR UPDATE SKIP LOCKED"):
		now, lease := args[0].(time.Time), args[1].(time.Time)
		var due []*row
		for _, r := range t.rows {
			if r.state == "pending" && !r.runAfter.After(now) {
				due = append(due, r)
			}
		}
		if len(due) == 0 {
			return scanRow{err: errors.New("no rows in result set")}
		}
		sort.Slice(due, func(i, j int) bool {
			if !due[i].runAfter.Equal(due[j].runAfter) {
				return due[i].runAfter.Before(due[j].runAfter)
			}
			return due[i].id < due[j].id
		})
		r := due[0]
		r.state, r.attempt = "running", r.attempt+1
		l := lease
		r.leasedUntil = &l
		return scanRow{vals: []any{r.id, r.kind, r.payload, r.attempt, r.maxAttempts, r.dedupe}}
	}
	return scanRow{err: fmt.Errorf("unexpected QueryRow: %s", sql)}
}

func (t *table) get(id int64) *row {
	t.mu.Lock()
	defer t.mu.Unlock()
	for _, r := range t.rows {
		if r.id == id {
			return r
		}
	}
	return nil
}

func rig() (*Outbox, *table, *time.Time) {
	now := time.Date(2026, 9, 30, 10, 0, 0, 0, time.UTC)
	o := &Outbox{Now: func() time.Time { return now }}
	return o, &table{}, &now
}

func TestAddDedupesLiveWorkOnly(t *testing.T) {
	ctx := context.Background()
	o, tb, _ := rig()
	id, err := o.AddTx(ctx, tb, Item{Kind: "shop.stock.sync", Payload: map[string]any{"sku": "A1"}, DedupeKey: "stock:A1"})
	if err != nil || id != 1 {
		t.Fatal(id, err)
	}
	if again, err := o.AddTx(ctx, tb, Item{Kind: "shop.stock.sync", Payload: map[string]any{"sku": "A1"}, DedupeKey: "stock:A1"}); err != nil || again != 0 {
		t.Fatalf("a duplicate live item: id %d err %v; want 0 and no error", again, err)
	}
	if other, err := o.AddTx(ctx, tb, Item{Kind: "shop.stock.sync", DedupeKey: "stock:B2"}); err != nil || other != 2 {
		t.Fatal(other, err)
	}
	if tb.get(2).payload != "{}" {
		t.Fatalf("a nil payload is stored as {} not %q", tb.get(2).payload)
	}
	// Once done, the same key is bookable again.
	res, err := o.Drain(ctx, tb, map[string]Handler{"shop.stock.sync": func(context.Context, Job) error { return nil }}, 10, time.Minute)
	if err != nil || res.Done != 2 {
		t.Fatal(res, err)
	}
	if id, _ := o.AddTx(ctx, tb, Item{Kind: "shop.stock.sync", DedupeKey: "stock:A1"}); id != 3 {
		t.Fatalf("after done, the key should be free; got id %d", id)
	}
	if tb.get(3).maxAttempts != 8 {
		t.Fatalf("default max_attempts %d", tb.get(3).maxAttempts)
	}
	// Two items without a key never collide.
	a, _ := o.AddTx(ctx, tb, Item{Kind: "x"})
	b, _ := o.AddTx(ctx, tb, Item{Kind: "x"})
	if a == 0 || b == 0 || a == b {
		t.Fatal(a, b)
	}
	if _, err := o.AddTx(ctx, tb, Item{Kind: "x", Payload: make(chan int)}); err == nil {
		t.Fatal("an unmarshallable payload was accepted")
	}
}

func TestDrainRetriesWithBackoffThenDies(t *testing.T) {
	ctx := context.Background()
	o, tb, now := rig()
	if _, err := o.AddTx(ctx, tb, Item{Kind: "flaky", MaxAttempts: 3}); err != nil {
		t.Fatal(err)
	}
	seen := 0
	handlers := map[string]Handler{"flaky": func(_ context.Context, j Job) error {
		seen++
		if j.Attempt != seen {
			t.Errorf("attempt %d on call %d", j.Attempt, seen)
		}
		return errors.New("upstream 502")
	}}
	res, err := o.Drain(ctx, tb, handlers, 10, time.Minute)
	if err != nil || res.Claimed != 1 || res.Failed != 1 {
		t.Fatalf("%+v %v", res, err)
	}
	r := tb.get(1)
	if r.state != "pending" || r.lastError != "upstream 502" || !r.runAfter.Equal(now.Add(time.Minute)) {
		t.Fatalf("after one failure: %+v", *r)
	}
	// Not due yet: nothing is claimed.
	if res, _ := o.Drain(ctx, tb, handlers, 10, time.Minute); res.Claimed != 0 {
		t.Fatalf("claimed an item before its backoff: %+v", res)
	}
	*now = now.Add(time.Minute)
	if res, _ := o.Drain(ctx, tb, handlers, 10, time.Minute); res.Failed != 1 || !tb.get(1).runAfter.Equal(now.Add(2*time.Minute)) {
		t.Fatalf("second failure: %+v run_after %v", res, tb.get(1).runAfter)
	}
	*now = now.Add(2 * time.Minute)
	res, _ = o.Drain(ctx, tb, handlers, 10, time.Minute)
	if res.Dead != 1 || tb.get(1).state != "dead" || seen != 3 {
		t.Fatalf("third failure should be dead: %+v state %s seen %d", res, tb.get(1).state, seen)
	}
	if res, _ := o.Drain(ctx, tb, handlers, 10, time.Minute); res.Claimed != 0 || seen != 3 {
		t.Fatal("a dead item was run again")
	}
}

func TestPermanentFailuresPanicsAndUnknownKindsDieAtOnce(t *testing.T) {
	ctx := context.Background()
	o, tb, _ := rig()
	_, _ = o.AddTx(ctx, tb, Item{Kind: "bad-input"})
	_, _ = o.AddTx(ctx, tb, Item{Kind: "panics"})
	_, _ = o.AddTx(ctx, tb, Item{Kind: "nobody-handles"})
	_, _ = o.AddTx(ctx, tb, Item{Kind: "fine", Payload: map[string]any{"n": 1}})
	var got Job
	handlers := map[string]Handler{
		"bad-input": func(context.Context, Job) error { return fmt.Errorf("%w: the sku no longer exists", ErrPermanent) },
		"panics":    func(context.Context, Job) error { panic("boom") },
		"fine":      func(_ context.Context, j Job) error { got = j; return nil },
	}
	res, err := o.Drain(ctx, tb, handlers, 10, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if res.Claimed != 4 || res.Done != 1 || res.Dead != 2 || res.Failed != 1 {
		t.Fatalf("%+v", res)
	}
	if tb.get(1).state != "dead" || !strings.Contains(tb.get(1).lastError, "sku no longer exists") {
		t.Fatalf("permanent: %+v", *tb.get(1))
	}
	if tb.get(2).state != "pending" || !strings.Contains(tb.get(2).lastError, "panicked") {
		t.Fatalf("a panic is a retryable failure: %+v", *tb.get(2))
	}
	if tb.get(3).state != "dead" || !strings.Contains(tb.get(3).lastError, "no handler") {
		t.Fatalf("no handler: %+v", *tb.get(3))
	}
	if tb.get(4).state != "done" || string(got.Payload) != `{"n":1}` || got.ID != 4 || got.MaxAttempts != 8 {
		t.Fatalf("fine: %+v job %+v", *tb.get(4), got)
	}
}

func TestDrainIsBoundedAndReclaimsExpiredLeases(t *testing.T) {
	ctx := context.Background()
	o, tb, now := rig()
	for i := 0; i < 5; i++ {
		_, _ = o.AddTx(ctx, tb, Item{Kind: "k"})
	}
	ran := 0
	handlers := map[string]Handler{"k": func(context.Context, Job) error { ran++; return nil }}
	if res, _ := o.Drain(ctx, tb, handlers, 2, time.Minute); res.Claimed != 2 || ran != 2 {
		t.Fatalf("max=2: %+v ran %d", res, ran)
	}
	// A spent budget stops the loop before the next claim.
	slow := map[string]Handler{"k": func(context.Context, Job) error { *now = now.Add(time.Hour); ran++; return nil }}
	if res, _ := o.Drain(ctx, tb, slow, 10, time.Minute); res.Claimed != 1 {
		t.Fatalf("a spent budget: %+v", res)
	}
	// A worker that died mid-item left it running with a lease; once the
	// lease passes, the next Drain takes it back.
	r := tb.get(4)
	r.state = "running"
	stale := now.Add(-time.Second)
	r.leasedUntil = &stale
	r5 := tb.get(5)
	r5.state = "running"
	fresh := now.Add(time.Hour)
	r5.leasedUntil = &fresh
	if res, _ := o.Drain(ctx, tb, handlers, 10, time.Minute); res.Claimed != 1 || tb.get(4).state != "done" || tb.get(5).state != "running" {
		t.Fatalf("reclaim: %+v, 4=%s 5=%s", res, tb.get(4).state, tb.get(5).state)
	}
	// Oldest run_after first; a store fault is returned, not swallowed.
	tb.fail = errors.New("connection refused")
	if _, err := o.Drain(ctx, tb, handlers, 10, time.Minute); err == nil || !strings.Contains(err.Error(), "connection refused") {
		t.Fatalf("store fault: %v", err)
	}
}

func TestBackoffDoublesAndCaps(t *testing.T) {
	want := []time.Duration{time.Minute, 2 * time.Minute, 4 * time.Minute, 8 * time.Minute, 16 * time.Minute, 30 * time.Minute, 30 * time.Minute}
	for i, w := range want {
		if got := Backoff(i + 1); got != w {
			t.Errorf("Backoff(%d) = %s, want %s", i+1, got, w)
		}
	}
	if Backoff(0) != time.Minute || Backoff(-3) != time.Minute || Backoff(1000) != 30*time.Minute {
		t.Error("edges")
	}
	if New().Now == nil || (&Outbox{}).now().IsZero() {
		t.Error("a zero Outbox still tells the time")
	}
	if !strings.Contains(DDL, "outbox_dedupe_live") || !strings.Contains(DDL, "state IN ('pending','running')") {
		t.Fatal(DDL)
	}
}
