// Package sharedwa is a product's door onto Zavon's shared WhatsApp number
// in core: booking messages (a ticket, a reminder, an update, a
// cancellation) for an organisation with no number of its own.
//
// Core holds the number, its Meta token and the fixed templates; a product
// names a template and fills named parameters, and core picks the order
// Meta wants. Core also keeps the STOP list for the shared number, and, when
// Meta later reports a message failed, sends the fallback email the product
// handed over — once. A product never speaks to Meta for the shared number.
//
// The wire: POST /api/whatsapp/messages and GET /api/whatsapp/shared, scope
// `send`, on the product's own core credential.
package sharedwa

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// The templates, by the name a product sends.
const (
	Ticket    = "booking_ticket"    // the place is booked; picture: the ticket card
	Reminder  = "booking_reminder"  // the event is coming; picture: the ticket card
	Update    = "booking_update"    // news about the booking, in Params.Text
	Cancelled = "booking_cancelled" // the booking is cancelled
)

// Templates is every name, in the order a screen lists them.
var Templates = []string{Ticket, Reminder, Update, Cancelled}

// NeedsImage reports whether a template's header is a picture.
func NeedsImage(template string) bool { return template == Ticket || template == Reminder }

// Params are the words. Core fits each to a template parameter (one line,
// at most 300 characters) and puts them in the template's order.
type Params struct {
	Attendee string `json:"attendee,omitempty"`
	Org      string `json:"org"`
	Event    string `json:"event"`
	When     string `json:"when,omitempty"`
	Where    string `json:"where,omitempty"`
	Code     string `json:"code,omitempty"`
	// Text is an update's news (booking_update only).
	Text string `json:"text,omitempty"`
}

// Fallback is the email core sends, once, if Meta reports the message
// failed after accepting it. The product renders it; core sends it as the
// product, for Tenant, under Topic when given.
type Fallback struct {
	Email    string `json:"email"`
	Name     string `json:"name,omitempty"`
	Subject  string `json:"subject"`
	HTML     string `json:"html,omitempty"`
	Text     string `json:"text"`
	FromName string `json:"from_name,omitempty"`
	Topic    string `json:"topic,omitempty"`
}

// Message is one send.
type Message struct {
	// Tenant is the organisation the message is about (its slug).
	Tenant   string `json:"tenant"`
	To       string `json:"to"`
	Template string `json:"template"`
	Params   Params `json:"params"`
	// Image is the ticket card's public HTTPS address (Ticket and Reminder).
	Image string `json:"image,omitempty"`
	// Link is where the Open button goes (HTTPS), through core's /n/ redirect.
	Link string `json:"link,omitempty"`
	// ConsentedAt is when the person agreed to WhatsApp messages. Required:
	// no phone message goes without one.
	ConsentedAt time.Time `json:"consented_at"`
	// Ref is the product's own id for this message, unique per product. A
	// repeat answers the first send's result and sends nothing.
	Ref      string    `json:"ref"`
	Fallback *Fallback `json:"fallback,omitempty"`
}

// Sent is core's answer.
type Sent struct {
	MessageID string `json:"message_id"`
	Status    string `json:"status"`
	Duplicate bool   `json:"duplicate"`
}

// Shared is the shared number's state as a product may see it.
type Shared struct {
	Configured bool `json:"configured"`
	// Templates maps each name to Meta's review: APPROVED, PENDING,
	// REJECTED, or MISSING when not yet submitted.
	Templates map[string]string `json:"templates"`
}

// Ready reports whether a template can send now.
func (s Shared) Ready(template string) bool {
	return s.Configured && strings.EqualFold(s.Templates[template], "APPROVED")
}

// Refusals, as errors.Is targets.
var (
	// ErrStopped: the person sent STOP to the Zavon number.
	ErrStopped = errors.New("sharedwa: this number has stopped WhatsApp messages from Zavon")
	// ErrUnconfigured: the shared number is not set up, or the template is
	// not approved yet. Nothing was sent; try another channel.
	ErrUnconfigured = errors.New("sharedwa: the shared WhatsApp number cannot send this yet")
)

// Error is any other refusal, with core's code and words.
type Error struct {
	Status int
	Code   string
	Detail string
}

func (e *Error) Error() string {
	return fmt.Sprintf("sharedwa: %d %s: %s", e.Status, e.Code, e.Detail)
}

// Client calls core.
type Client struct {
	base      string
	authorise func(*http.Request) error
	http      *http.Client
}

// New builds a client. authorise sets the request's credential (a bearer
// property token, a platform token — whatever the product already uses
// with core).
func New(baseURL string, authorise func(*http.Request) error) *Client {
	return &Client{base: strings.TrimRight(baseURL, "/"), authorise: authorise, http: &http.Client{Timeout: 20 * time.Second}}
}

// Send sends one message.
func (c *Client) Send(ctx context.Context, m Message) (Sent, error) {
	var out Sent
	err := c.call(ctx, http.MethodPost, "/api/whatsapp/messages", m, &out)
	return out, err
}

// State reads the shared number's state.
func (c *Client) State(ctx context.Context) (Shared, error) {
	var out Shared
	err := c.call(ctx, http.MethodGet, "/api/whatsapp/shared", nil, &out)
	return out, err
}

func (c *Client) call(ctx context.Context, method, path string, in, out any) error {
	if c == nil || c.base == "" {
		return ErrUnconfigured
	}
	var body io.Reader
	if in != nil {
		raw, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.authorise != nil {
		if err := c.authorise(req); err != nil {
			return err
		}
	}
	res, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("sharedwa: core unreachable: %w", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		var e struct {
			Error  string `json:"error"`
			Reason string `json:"reason"`
			Detail string `json:"detail"`
		}
		_ = json.Unmarshal(raw, &e)
		switch {
		case res.StatusCode == http.StatusConflict && e.Error == CodeStopped:
			return ErrStopped
		case res.StatusCode == http.StatusServiceUnavailable && (e.Error == CodeUnconfigured || e.Error == CodeNotApproved):
			return fmt.Errorf("%w (%s)", ErrUnconfigured, e.Error)
		}
		detail := e.Detail
		if detail == "" {
			detail = e.Reason
		}
		if detail == "" {
			detail = strings.TrimSpace(string(raw))
		}
		return &Error{Status: res.StatusCode, Code: e.Error, Detail: detail}
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(raw, out)
}

// The error codes core answers with.
const (
	CodeStopped      = "stopped"
	CodeUnconfigured = "whatsapp_unconfigured"
	CodeNotApproved  = "template_not_approved"
	CodeMetaRefused  = "meta_refused"
)
