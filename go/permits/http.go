package permits

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// HTTPRefresher reads the identity service's GET /api/orgs/{slug}/permits?app=.
//
// Token is a bearer token the identity service accepts for that endpoint.
// Never call it inside a database transaction: it waits on another service.
//
// The service's failures mean different things and are kept apart:
//
//	503  the service could not verify the token right now
//	401  the token is not active
//	403  the caller may not read permits, or not for that app
//	404  the service knows no organisation by that slug (ErrNoSuchOrg)
type HTTPRefresher struct {
	BaseURL string // e.g. https://identity.example.com
	Token   string
	HTTP    *http.Client
}

// ErrUnconfigured is a refresher with no base URL or no token.
var ErrUnconfigured = errors.New("permits: no identity service URL or token, so nothing can be fetched")

// ErrNoSuchOrg is a slug the identity service does not know.
var ErrNoSuchOrg = errors.New("permits: the identity service knows no organisation by that slug")

// Fetch implements Refresher.
func (h HTTPRefresher) Fetch(ctx context.Context, org, app string, ifNoneMatch int64) (Snapshot, error) {
	if strings.TrimSpace(h.BaseURL) == "" || strings.TrimSpace(h.Token) == "" {
		return Snapshot{}, ErrUnconfigured
	}
	u := strings.TrimRight(h.BaseURL, "/") + "/api/orgs/" + url.PathEscape(org) + "/permits?app=" + url.QueryEscape(app)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return Snapshot{}, err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(h.Token))
	req.Header.Set("Accept", "application/json")
	if ifNoneMatch > 0 {
		req.Header.Set("If-None-Match", `"`+strconv.FormatInt(ifNoneMatch, 10)+`"`)
	}
	client := h.HTTP
	if client == nil {
		client = &http.Client{Timeout: 8 * time.Second}
	}
	res, err := client.Do(req)
	if err != nil {
		return Snapshot{}, fmt.Errorf("permits: the identity service did not answer: %w", err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	why := func() string {
		var e struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(body, &e) == nil && e.Error != "" {
			return e.Error
		}
		return strings.TrimSpace(string(body))
	}
	switch res.StatusCode {
	case http.StatusOK:
	case http.StatusNotModified:
		return Snapshot{}, ErrNotModified
	case http.StatusNotFound:
		return Snapshot{}, fmt.Errorf("%w (%s)", ErrNoSuchOrg, org)
	case http.StatusUnauthorized:
		return Snapshot{}, fmt.Errorf("permits: the identity service says the token is not active: %s", why())
	case http.StatusForbidden:
		return Snapshot{}, fmt.Errorf("permits: the identity service refused the token: %s", why())
	case http.StatusServiceUnavailable:
		return Snapshot{}, fmt.Errorf("permits: the identity service could not verify the token right now: %s", why())
	default:
		return Snapshot{}, fmt.Errorf("permits: the identity service answered %d: %s", res.StatusCode, why())
	}
	var s Snapshot
	if err := json.Unmarshal(body, &s); err != nil {
		return Snapshot{}, fmt.Errorf("permits: the identity service's answer cannot be read: %w", err)
	}
	if s.Org != "" && s.Org != org {
		return Snapshot{}, fmt.Errorf("permits: the identity service answered for %q when asked about %q", s.Org, org)
	}
	if s.Version <= 0 {
		return Snapshot{}, errors.New("permits: the identity service answered without a version")
	}
	s.Org, s.App = org, app
	return s, nil
}
