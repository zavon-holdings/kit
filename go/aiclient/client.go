package aiclient

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// TokenSource returns the bearer credential for one request. It is called on
// EVERY request: a platform-issued token rotates, and a copy cached at start
// works until the first rotation, then fails for the life of the instance.
type TokenSource func() string

// StaticToken is a credential that never changes (a property token).
func StaticToken(token string) TokenSource { return func() string { return token } }

// EnvToken reads the first named environment variable that has a value, on
// every request. For example EnvToken("CORE_TOKEN", "VERCEL_OIDC_TOKEN"): an
// issued token wins; with none, the platform's own identity.
func EnvToken(names ...string) TokenSource {
	return func() string {
		for _, n := range names {
			if v := strings.TrimSpace(os.Getenv(n)); v != "" {
				return v
			}
		}
		return ""
	}
}

// Timeouts per call. Invoke is 45 s: under a 60 s function, with room to
// answer. Everything else is short: a screen must not hang on a status.
const (
	InvokeTimeout = 45 * time.Second
	ShortTimeout  = 5 * time.Second
)

// Client speaks to one gateway with one property credential.
type Client struct {
	base  string
	token TokenSource
	http  *http.Client
	// property rides as ?property= for an operator credential, which acts
	// for a named property. A property credential needs none.
	property string
}

// Option adjusts a Client.
type Option func(*Client)

// WithHTTPClient replaces the transport. Timeouts are per call (see
// InvokeTimeout); a client-level timeout shorter than those would cut an
// invoke short.
func WithHTTPClient(h *http.Client) Option { return func(c *Client) { c.http = h } }

// WithProperty names the property an operator credential acts for.
func WithProperty(property string) Option { return func(c *Client) { c.property = property } }

// New builds a client.
func New(baseURL string, token TokenSource, opts ...Option) *Client {
	if token == nil {
		token = StaticToken("")
	}
	c := &Client{base: strings.TrimRight(strings.TrimSpace(baseURL), "/"), token: token, http: &http.Client{}}
	for _, o := range opts {
		o(c)
	}
	return c
}

// Configured says whether this client can call anything now.
func (c *Client) Configured() bool { return c.base != "" && c.token() != "" }

// Meta is what a call answers beside its body.
type Meta struct {
	Status int
	// Replayed is Idempotent-Replay: the gateway answered a stored response
	// to a key it had seen, and charged nothing new.
	Replayed bool
}

func (c *Client) call(ctx context.Context, timeout time.Duration, method, path string, query url.Values, idemKey string, body, into any) (Meta, error) {
	var meta Meta
	token := c.token()
	if c.base == "" || token == "" {
		return meta, ErrNotConfigured
	}
	if timeout > 0 {
		// A caller's earlier deadline still wins: WithTimeout keeps it.
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, timeout)
		defer cancel()
	}
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return meta, err
		}
		reader = bytes.NewReader(raw)
	}
	if c.property != "" {
		if query == nil {
			query = url.Values{}
		}
		query.Set("property", c.property)
	}
	u := c.base + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, u, reader)
	if err != nil {
		return meta, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if idemKey != "" {
		req.Header.Set("Idempotency-Key", idemKey)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return meta, fmt.Errorf("%w: %v", ErrUnreachable, err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return meta, fmt.Errorf("%w: reading the answer: %v", ErrUnreachable, err)
	}
	meta.Status = resp.StatusCode
	meta.Replayed = resp.Header.Get("Idempotent-Replay") == "true"
	if resp.StatusCode >= 300 {
		e := &Error{Status: resp.StatusCode}
		if json.Unmarshal(raw, e) != nil || e.Message == "" {
			e.Message = strings.TrimSpace(string(raw))
			if e.Message == "" {
				e.Message = http.StatusText(resp.StatusCode)
			}
		}
		return meta, e
	}
	if into != nil && len(raw) > 0 {
		if err := json.Unmarshal(raw, into); err != nil {
			return meta, fmt.Errorf("aiclient: the gateway's answer could not be read: %w", err)
		}
	}
	return meta, nil
}

// Invoke runs an inline tool. idemKey is required: a retry with the same key
// and body is answered from the first attempt and charged once.
func (c *Client) Invoke(ctx context.Context, idemKey string, req InvokeRequest) (InvokeResult, Meta, error) {
	var out InvokeResult
	if strings.TrimSpace(idemKey) == "" {
		return out, Meta{}, fmt.Errorf("aiclient: an Idempotency-Key is required")
	}
	m, err := c.call(ctx, InvokeTimeout, http.MethodPost, "/api/ai/invoke", nil, idemKey, req, &out)
	return out, m, err
}

// StartJob enqueues a long tool. The answer is the job to poll with Job.
func (c *Client) StartJob(ctx context.Context, idemKey string, req InvokeRequest) (JobAccepted, Meta, error) {
	var out JobAccepted
	if strings.TrimSpace(idemKey) == "" {
		return out, Meta{}, fmt.Errorf("aiclient: an Idempotency-Key is required")
	}
	m, err := c.call(ctx, ShortTimeout*3, http.MethodPost, "/api/ai/jobs", nil, idemKey, req, &out)
	return out, m, err
}

// Job reads one job of the tenant's.
func (c *Client) Job(ctx context.Context, tenant, id string) (Job, error) {
	var out Job
	_, err := c.call(ctx, ShortTimeout, http.MethodGet, "/api/ai/jobs/"+url.PathEscape(id),
		url.Values{"tenant": {tenant}}, "", nil, &out)
	return out, err
}

// Status is what a screen renders: state, balance and each tool's price.
// sub may be "".
func (c *Client) Status(ctx context.Context, tenant, actorEmail, sub string) (Status, error) {
	var out Status
	q := url.Values{"tenant": {tenant}, "actor": {strings.ToLower(strings.TrimSpace(actorEmail))}}
	if sub != "" {
		q.Set("sub", sub)
	}
	_, err := c.call(ctx, ShortTimeout, http.MethodGet, "/api/ai/status", q, "", nil, &out)
	return out, err
}

// SendFeedback records whether a result was used, and a rating.
func (c *Client) SendFeedback(ctx context.Context, f Feedback) error {
	_, err := c.call(ctx, ShortTimeout, http.MethodPost, "/api/ai/feedback", nil, "", f, nil)
	return err
}

// OrgSummary reads one organisation's AI settings and numbers. rng is a
// range such as "30d"; "" is the gateway's default.
func (c *Client) OrgSummary(ctx context.Context, tenant, rng string) (OrgSummary, error) {
	var out OrgSummary
	var q url.Values
	if rng != "" {
		q = url.Values{"range": {rng}}
	}
	_, err := c.call(ctx, ShortTimeout*2, http.MethodGet, "/api/ai/org/"+url.PathEscape(tenant)+"/summary", q, "", nil, &out)
	return out, err
}

// SetOrgSettings sets an organisation's monthly cap or records that its
// administrator accepted the privacy notice.
func (c *Client) SetOrgSettings(ctx context.Context, tenant string, s OrgSettings) (OrgSummary, error) {
	var out OrgSummary
	_, err := c.call(ctx, ShortTimeout*2, http.MethodPut, "/api/ai/org/"+url.PathEscape(tenant)+"/settings", nil, "", s, &out)
	return out, err
}
