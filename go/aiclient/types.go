// Package aiclient is a client for an AI gateway's property routes
// (/api/ai/*): invoke a tool, start and read a job, read the status a screen
// renders, send feedback, and (for an identity service) read and set an
// organisation's AI settings.
//
// The gateway holds the model key, the prices and the permissions. A caller
// sends who is asking and what, never what it costs or what it may do: the
// request has no price field and no permission field, and the gateway
// refuses a body that carries either.
//
// Units: fields named *_tenths are tenths of a credit, as integers. Credits,
// CreditsCharged, Balance and Required (a 402) are whole credits, which may
// be fractional.
package aiclient

import (
	"encoding/json"
	"errors"
	"fmt"
)

// States a status answer carries, in the order the gateway checks them.
const (
	StateNotConfigured = "not_configured"
	StateOff           = "off"
	StateBlocked       = "blocked"
	StateNoPermission  = "no_permission"
	StateNoCredits     = "no_credits"
	StateReady         = "ready"
)

// Pricing modes of a tool.
const (
	PricingFixed   = "fixed"
	PricingMetered = "metered"
	PricingFree    = "free"
)

// Job statuses.
const (
	JobQueued    = "queued"
	JobRunning   = "running"
	JobDone      = "done"
	JobFailed    = "failed"
	JobCancelled = "cancelled"
)

// Error codes the gateway answers.
const (
	CodeInvalidBody            = "invalid_body"
	CodeInvalidInput           = "invalid_input"
	CodeIdempotencyKeyRequired = "idempotency_key_required"
	CodeIdempotencyKeyReused   = "idempotency_key_reused"
	CodeNotFound               = "not_found"
	CodeNotConfigured          = "ai_not_configured"
	CodeOff                    = "ai_off"
	CodeUnavailable            = "ai_unavailable"
	CodeBlocked                = "ai_blocked"
	CodeActingRefused          = "acting_refused"
	CodeMissingPermission      = "missing_permission"
	CodeRateLimited            = "rate_limited"
	CodeDailyLimit             = "daily_limit"
	CodeCapReached             = "ai_cap_reached"
	CodeInsufficientCredits    = "insufficient_credits"
	CodeRefused                = "ai_refused"
	CodeProviderError          = "ai_provider_error"
	CodeOutputInvalid          = "ai_output_invalid"
	CodeOutputRefused          = "ai_output_refused"
	CodeTimeout                = "ai_timeout"
	CodeForbidden              = "forbidden"
)

// Actor is the person a request is for. The caller has verified them; the
// gateway checks their permissions again against its own copy.
type Actor struct {
	Email string `json:"email"`
	Sub   string `json:"sub"`
	// Acting is a session in which somebody acts as another person. The
	// gateway refuses it: spend must belong to a real member.
	Acting bool `json:"acting"`
}

// InvokeRequest is the body of POST /api/ai/invoke and POST /api/ai/jobs.
type InvokeRequest struct {
	Tenant   string          `json:"tenant"`
	Actor    Actor           `json:"actor"`
	ToolKey  string          `json:"tool_key"`
	Resource string          `json:"resource"`
	Input    json.RawMessage `json:"input"`
}

// InvokeResult is a tool's answer and what it cost.
type InvokeResult struct {
	Result         json.RawMessage `json:"result"`
	CreditsCharged float64         `json:"credits_charged"`
	Balance        float64         `json:"balance"`
	UsageEventID   string          `json:"usage_event_id"`
}

// ToolStatus is one tool as a screen shows it.
type ToolStatus struct {
	Key string `json:"key"`
	// Credits is the price in whole credits: the fixed price, the hold for a
	// metered tool, 0 for a free one.
	Credits     float64 `json:"credits"`
	PricingMode string  `json:"pricing_mode"`
	Allowed     bool    `json:"allowed"`
	// Reason is "" when allowed, else missing_permission or no_credits.
	Reason string `json:"reason"`
}

// Status is GET /api/ai/status.
type Status struct {
	State string `json:"state"`
	// Layer names the switch that is off: env, platform, product, org,
	// org_product, block_tenant or block_actor. "" otherwise.
	Layer            string       `json:"layer"`
	BalanceTenths    int64        `json:"balance_tenths"`
	MonthlyCapTenths int64        `json:"monthly_cap_tenths"`
	MonthlyCap       float64      `json:"monthly_cap"`
	MonthUsedTenths  int64        `json:"month_used_tenths"`
	Notice           string       `json:"notice"`
	Tools            []ToolStatus `json:"tools"`
}

// Tool finds one tool in a status, by key.
func (s Status) Tool(key string) (ToolStatus, bool) {
	for _, t := range s.Tools {
		if t.Key == key {
			return t, true
		}
	}
	return ToolStatus{}, false
}

// Shown says whether AI controls are drawn at all: hidden when not
// configured, off or blocked; greyed (drawn, not usable) for no permission
// or no credits.
func (s Status) Shown() bool {
	switch s.State {
	case StateNoPermission, StateNoCredits, StateReady:
		return true
	}
	return false
}

// JobAccepted is POST /api/ai/jobs.
type JobAccepted struct {
	JobID  string `json:"job_id"`
	Status string `json:"status"`
}

// Job is GET /api/ai/jobs/{id}.
type Job struct {
	ID             string          `json:"id"`
	Status         string          `json:"status"`
	Result         json.RawMessage `json:"result"`
	Error          string          `json:"error"`
	CreditsCharged float64         `json:"credits_charged"`
	Balance        float64         `json:"balance"`
	UsageEventID   string          `json:"usage_event_id"`
}

// Finished says whether a job will change no further.
func (j Job) Finished() bool {
	return j.Status == JobDone || j.Status == JobFailed || j.Status == JobCancelled
}

// Feedback is POST /api/ai/feedback. Only Tenant and UsageEventID are
// required.
type Feedback struct {
	Tenant       string   `json:"tenant"`
	UsageEventID string   `json:"usage_event_id"`
	Accepted     *bool    `json:"accepted,omitempty"`
	EditRatio    *float64 `json:"edit_ratio,omitempty"`
	Rating       *int     `json:"rating,omitempty"`
	Comment      string   `json:"comment,omitempty"`
}

// LedgerLine is one line of an organisation's AI credit ledger.
type LedgerLine struct {
	At          string `json:"at"`
	DeltaTenths int64  `json:"delta_tenths"`
	Reason      string `json:"reason"`
	Ref         string `json:"ref"`
	Actor       string `json:"actor"`
}

// OrgSummary is GET /api/ai/org/{tenant}/summary: one organisation's AI
// settings and numbers, for its own administrators.
type OrgSummary struct {
	Tenant                string                     `json:"tenant"`
	State                 string                     `json:"state"`
	Layer                 string                     `json:"layer"`
	Features              map[string]bool            `json:"features"`
	BalanceTenths         int64                      `json:"balance_tenths"`
	MonthlyCapTenths      int64                      `json:"monthly_cap_tenths"`
	MonthUsedTenths       int64                      `json:"month_used_tenths"`
	PopiaNoticeAcceptedAt string                     `json:"popia_notice_accepted_at"`
	PopiaNoticeAcceptedBy string                     `json:"popia_notice_accepted_by"`
	Widgets               map[string]json.RawMessage `json:"widgets"`
	Ledger                []LedgerLine               `json:"ledger"`
}

// OrgSettings is PUT /api/ai/org/{tenant}/settings. Nil fields are left as
// they are.
type OrgSettings struct {
	Actor             Actor  `json:"actor"`
	MonthlyCapTenths  *int64 `json:"monthly_cap_tenths,omitempty"`
	AcceptPopiaNotice *bool  `json:"accept_popia_notice,omitempty"`
}

// Error is an answer that was not a success.
type Error struct {
	Status  int             `json:"-"`
	Code    string          `json:"code"`
	Message string          `json:"error"`
	Detail  json.RawMessage `json:"detail,omitempty"`
	// Layer is the switch that is off, on ai_off.
	Layer string `json:"layer,omitempty"`
	// Required is a permission string on missing_permission and a number of
	// whole credits on insufficient_credits. Read it with RequiredPermission
	// or RequiredCredits.
	Required       json.RawMessage `json:"required,omitempty"`
	Balance        *float64        `json:"balance,omitempty"`
	RequiredTenths *int64          `json:"required_tenths,omitempty"`
	BalanceTenths  *int64          `json:"balance_tenths,omitempty"`
	CreditsCharged *float64        `json:"credits_charged,omitempty"`
}

func (e *Error) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("the AI gateway answered %d %s: %s", e.Status, e.Code, e.Message)
	}
	return fmt.Sprintf("the AI gateway answered %d: %s", e.Status, e.Message)
}

// RequiredPermission is the permission a missing_permission names, or "".
func (e *Error) RequiredPermission() string {
	var s string
	if json.Unmarshal(e.Required, &s) == nil {
		return s
	}
	return ""
}

// RequiredCredits is the whole credits an insufficient_credits needs, or 0.
func (e *Error) RequiredCredits() float64 {
	var f float64
	if json.Unmarshal(e.Required, &f) == nil {
		return f
	}
	return 0
}

// ErrUnreachable wraps a transport failure: the gateway did not answer.
var ErrUnreachable = errors.New("aiclient: the AI gateway did not answer")

// ErrNotConfigured is a call on a client with no address or no credential.
var ErrNotConfigured = errors.New("aiclient: no gateway address or credential is configured")

// Code is the code of an error, or "".
func Code(err error) string {
	var e *Error
	if errors.As(err, &e) {
		return e.Code
	}
	return ""
}

// IsNotConfigured says whether the gateway has no model key, or this client
// has no address or credential. A state to render (hide the controls), not a
// fault.
func IsNotConfigured(err error) bool {
	return errors.Is(err, ErrNotConfigured) || Code(err) == CodeNotConfigured
}

// IsOff says whether a switch is off. Also a state to render.
func IsOff(err error) bool { return Code(err) == CodeOff }

// IsUnavailable says whether the gateway DID NOT DECIDE: unreachable, or a
// 5xx that is not a configured state. Try again later.
func IsUnavailable(err error) bool {
	if errors.Is(err, ErrUnreachable) {
		return true
	}
	var e *Error
	if !errors.As(err, &e) {
		return false
	}
	return e.Status >= 500 && e.Code != CodeNotConfigured && e.Code != CodeOff
}
