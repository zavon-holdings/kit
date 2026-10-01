// Package webhooksig signs and verifies the X-Zavon-* request signature.
//
// The signature is the hex HMAC-SHA256 of "<unix seconds>.<raw body>" under a
// shared secret, sent as X-Zavon-Signature beside
// X-Zavon-Timestamp, and a request more than five minutes either side of now
// is refused.
//
// The header may also carry `v1=<hex>`, and during a secret rotation a
// comma-separated list (`v1=<new>, v1=<old>`). Verify accepts any listed value
// made with any of the secrets it holds, and still accepts the bare hex.
//
// Fails closed: no secret means every request is refused, never "allow".
package webhooksig

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Header names.
const (
	HeaderSignature = "X-Zavon-Signature"
	HeaderTimestamp = "X-Zavon-Timestamp"
)

// MaxSkew bounds how old (or how far in the future) a signed request may be.
const MaxSkew = 5 * time.Minute

// MaxBody is the most VerifyRequest will read. A callback body is a few
// kilobytes; anything near this is not one.
const MaxBody = 4 << 20

// Errors Verify returns. Each is a refusal; none is retryable by the caller
// sending the same bytes again.
var (
	ErrNoSecret     = errors.New("webhooksig: no signing secret is configured, so every request is refused")
	ErrMissing      = errors.New("webhooksig: signed requests need both " + HeaderSignature + " and " + HeaderTimestamp)
	ErrBadTimestamp = errors.New("webhooksig: " + HeaderTimestamp + " must be unix seconds")
	ErrSkew         = fmt.Errorf("webhooksig: request timestamp is outside the %s window", MaxSkew)
	ErrMismatch     = errors.New("webhooksig: signature does not match")
	ErrTooLarge     = errors.New("webhooksig: body is too large")
)

// Sign is the bare hex signature — byte-identical to the workflow service's auth.Sign.
func Sign(secret string, timestamp int64, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	fmt.Fprintf(mac, "%d.", timestamp)
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

// Header is the X-Zavon-Signature value for a callback: one `v1=<hex>` per
// secret, comma-separated, current secret first. Empty secrets are skipped.
func Header(secrets []string, timestamp int64, body []byte) string {
	parts := make([]string, 0, len(secrets))
	for _, s := range secrets {
		if s == "" {
			continue
		}
		parts = append(parts, "v1="+Sign(s, timestamp, body))
	}
	return strings.Join(parts, ", ")
}

// Verify checks one signature header against any of the secrets.
//
// header is the X-Zavon-Signature value (bare hex, or a `v1=` list);
// tsHeader the X-Zavon-Timestamp value.
func Verify(secrets []string, header, tsHeader string, body []byte, now time.Time) error {
	live := make([]string, 0, len(secrets))
	for _, s := range secrets {
		if s != "" {
			live = append(live, s)
		}
	}
	if len(live) == 0 {
		return ErrNoSecret
	}
	header, tsHeader = strings.TrimSpace(header), strings.TrimSpace(tsHeader)
	if header == "" || tsHeader == "" {
		return ErrMissing
	}
	sent, err := strconv.ParseInt(tsHeader, 10, 64)
	if err != nil {
		return ErrBadTimestamp
	}
	if drift := now.Sub(time.Unix(sent, 0)); drift > MaxSkew || drift < -MaxSkew {
		return ErrSkew
	}
	presented := candidates(header)
	for _, s := range live {
		want := Sign(s, sent, body)
		for _, got := range presented {
			if subtle.ConstantTimeCompare([]byte(want), []byte(got)) == 1 {
				return nil
			}
		}
	}
	return ErrMismatch
}

// candidates reads the signature values out of a header. A value with a
// version other than v1 is ignored rather than tried: a future scheme must not
// be compared as though it were this one.
func candidates(header string) []string {
	var out []string
	for _, part := range strings.Split(header, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if k, v, ok := strings.Cut(part, "="); ok {
			if k == "v1" {
				out = append(out, strings.TrimSpace(v))
			}
			continue
		}
		out = append(out, part) // bare hex: the workflow service's own Sign
	}
	return out
}

// VerifyRequest reads the body (at most MaxBody) and verifies the request's
// signature before anybody parses it. The body is returned for the caller to
// decode; on error it must not be acted on.
func VerifyRequest(r *http.Request, secrets []string, now time.Time) ([]byte, error) {
	body, err := io.ReadAll(io.LimitReader(r.Body, MaxBody+1))
	if err != nil {
		return nil, err
	}
	if len(body) > MaxBody {
		return nil, ErrTooLarge
	}
	if err := Verify(secrets, r.Header.Get(HeaderSignature), r.Header.Get(HeaderTimestamp), body, now); err != nil {
		return nil, err
	}
	return body, nil
}

// SignRequest sets the two headers on an outbound request.
func SignRequest(r *http.Request, secrets []string, body []byte, now time.Time) {
	ts := now.Unix()
	r.Header.Set(HeaderTimestamp, strconv.FormatInt(ts, 10))
	r.Header.Set(HeaderSignature, Header(secrets, ts, body))
}
