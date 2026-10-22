// Package whatsapp speaks Meta's WhatsApp Cloud API: send a template or a
// reply, upload media, read a number and its templates, submit a template,
// subscribe an account's callbacks, finish Embedded Signup, upload a
// template's example picture; and, on the way in, verify a callback's
// signature, answer the handshake and flatten what a callback says.
//
// It holds no credential of its own. A client is built from whichever token
// the caller holds — the platform's shared number in core, an organisation's
// own number in a product — and the token is never cached beyond it.
//
// Started from Reach's app/channels/meta_whatsapp, which keeps its copy until
// it is next touched.
package whatsapp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"strings"
	"time"
)

// GraphVersion is pinned. Meta deprecates versions on a schedule, and a client
// that follows "latest" changes behaviour on their timetable rather than ours.
const GraphVersion = "v21.0"

// Client calls the Graph API with one access token.
type Client struct {
	baseURL string
	token   string
	http    *http.Client
}

// Option configures a Client.
type Option func(*Client)

// WithBaseURL points the client somewhere other than graph.facebook.com — a
// test server. The version is part of the URL given.
func WithBaseURL(u string) Option { return func(c *Client) { c.baseURL = strings.TrimRight(u, "/") } }

// WithHTTPClient replaces the default client (20 s timeout).
func WithHTTPClient(h *http.Client) Option { return func(c *Client) { c.http = h } }

// New builds a client for one token.
func New(token string, opts ...Option) *Client {
	c := &Client{
		baseURL: "https://graph.facebook.com/" + GraphVersion,
		token:   token,
		http:    &http.Client{Timeout: 20 * time.Second},
	}
	for _, o := range opts {
		if o != nil {
			o(c)
		}
	}
	return c
}

// Error is Meta's answer to a refused request. Code is Meta's number
// ((#132001) is a template that does not exist), which is what a caller
// decides on; Message is Meta's words, worth repeating as they are.
type Error struct {
	Status  int
	Code    int
	Subcode int
	Type    string
	Message string
}

func (e *Error) Error() string {
	if e.Code != 0 {
		return fmt.Sprintf("meta: (#%d) %s", e.Code, e.Message)
	}
	return "meta: " + e.Message
}

// CodeOf is the Meta error code inside err, or 0.
func CodeOf(err error) int {
	var e *Error
	if errors.As(err, &e) {
		return e.Code
	}
	return 0
}

// Number is what Meta says about a phone number.
type Number struct {
	ID string `json:"id"`
	// VerifiedName is the display name a recipient sees.
	VerifiedName string `json:"verified_name"`
	DisplayPhone string `json:"display_phone_number"`
	// CodeVerificationStatus is VERIFIED or NOT_VERIFIED.
	CodeVerificationStatus string `json:"code_verification_status"`
	// QualityRating is GREEN, YELLOW or RED.
	QualityRating string `json:"quality_rating"`
	// NameStatus is the display name's review: APPROVED, PENDING_REVIEW,
	// DECLINED — not the number's own state.
	NameStatus string `json:"name_status"`
}

// Number reads the state of one phone number.
func (c *Client) Number(ctx context.Context, phoneNumberID string) (Number, error) {
	var out Number
	q := url.Values{"fields": {"id,verified_name,display_phone_number,code_verification_status,quality_rating,name_status"}}
	err := c.do(ctx, http.MethodGet, "/"+url.PathEscape(phoneNumberID), q, nil, &out)
	return out, err
}

// Template is one message shape, as Meta holds it.
type Template struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Language string `json:"language"`
	Category string `json:"category"`
	// Status is APPROVED, PENDING, REJECTED, PAUSED or DISABLED.
	Status string `json:"status"`
	// Reason is why a rejected template was rejected, in Meta's words.
	Reason     string           `json:"rejected_reason"`
	Components []map[string]any `json:"components"`
}

// Templates lists what a WhatsApp Business Account holds, following Meta's
// pages to the end.
func (c *Client) Templates(ctx context.Context, wabaID string) ([]Template, error) {
	var all []Template
	q := url.Values{"limit": {"200"}, "fields": {"id,name,language,category,status,rejected_reason,components"}}
	for page := 0; page < 20; page++ {
		var out struct {
			Data   []Template `json:"data"`
			Paging struct {
				Cursors struct {
					After string `json:"after"`
				} `json:"cursors"`
				Next string `json:"next"`
			} `json:"paging"`
		}
		if err := c.do(ctx, http.MethodGet, "/"+url.PathEscape(wabaID)+"/message_templates", q, nil, &out); err != nil {
			return nil, err
		}
		all = append(all, out.Data...)
		if out.Paging.Next == "" || out.Paging.Cursors.After == "" {
			break
		}
		q.Set("after", out.Paging.Cursors.After)
	}
	return all, nil
}

// NewTemplate is a submission, in Meta's shape.
type NewTemplate struct {
	Name     string `json:"name"`
	Language string `json:"language"`
	Category string `json:"category"`
	// MessageSendTTLSeconds bounds how long Meta keeps trying to deliver
	// (authentication and utility only); 0 leaves Meta's default.
	MessageSendTTLSeconds int              `json:"message_send_ttl_seconds,omitempty"`
	Components            []map[string]any `json:"components"`
}

// Submit sends a template for Meta's review. The answer is usually PENDING:
// review takes minutes to a day.
func (c *Client) Submit(ctx context.Context, wabaID string, t NewTemplate) (Template, error) {
	var out Template
	err := c.do(ctx, http.MethodPost, "/"+url.PathEscape(wabaID)+"/message_templates", nil, t, &out)
	if out.Name == "" {
		out.Name = t.Name
	}
	if out.Language == "" {
		out.Language = t.Language
	}
	return out, err
}

// Subscribe subscribes the app holding the token to an account's callbacks.
// With a callback URL, the account's callbacks go there instead of the
// app's own webhook (Meta's per-account override), so two services sharing
// one Meta app each hear about their own numbers.
func (c *Client) Subscribe(ctx context.Context, wabaID, callbackURL, verifyToken string) error {
	body := map[string]any{}
	if callbackURL != "" {
		body["override_callback_uri"] = callbackURL
		body["verify_token"] = verifyToken
	}
	var out struct {
		Success bool `json:"success"`
	}
	if err := c.do(ctx, http.MethodPost, "/"+url.PathEscape(wabaID)+"/subscribed_apps", nil, body, &out); err != nil {
		return err
	}
	if !out.Success {
		return &Error{Message: "the subscription was not confirmed"}
	}
	return nil
}

// Message is one template message.
type Message struct {
	// To is the recipient's number, E.164 with or without the +.
	To       string
	Template string
	Language string
	// Body fills the body's {{1}}, {{2}}, … in order. Pass each through
	// Param: Meta refuses a parameter with a newline or a tab.
	Body []string
	// ImageLink fills an IMAGE header with a public HTTPS link Meta fetches.
	ImageLink string
	// ImageID fills an IMAGE header with media uploaded by UploadMedia.
	ImageID string
	// URLButtons fill the dynamic suffix of URL buttons, by button index.
	URLButtons map[int]string
	// Code is an authentication template's one-time code: the body's {{1}}
	// and the copy-code button's parameter, which Meta wants both.
	Code string
}

func (m Message) payload() map[string]any {
	var components []map[string]any
	switch {
	case m.ImageID != "":
		components = append(components, map[string]any{
			"type": "header", "parameters": []map[string]any{{"type": "image", "image": map[string]any{"id": m.ImageID}}},
		})
	case m.ImageLink != "":
		components = append(components, map[string]any{
			"type": "header", "parameters": []map[string]any{{"type": "image", "image": map[string]any{"link": m.ImageLink}}},
		})
	}
	body := m.Body
	if m.Code != "" {
		body = []string{m.Code}
	}
	if len(body) > 0 {
		values := make([]map[string]any, 0, len(body))
		for _, p := range body {
			values = append(values, map[string]any{"type": "text", "text": p})
		}
		components = append(components, map[string]any{"type": "body", "parameters": values})
	}
	if m.Code != "" {
		components = append(components, map[string]any{
			"type": "button", "sub_type": "url", "index": "0",
			"parameters": []map[string]any{{"type": "text", "text": m.Code}},
		})
	}
	for i := 0; i < 10; i++ {
		suffix, ok := m.URLButtons[i]
		if !ok {
			continue
		}
		components = append(components, map[string]any{
			"type": "button", "sub_type": "url", "index": fmt.Sprint(i),
			"parameters": []map[string]any{{"type": "text", "text": suffix}},
		})
	}
	tmpl := map[string]any{"name": m.Template, "language": map[string]any{"code": m.Language}}
	if len(components) > 0 {
		tmpl["components"] = components
	}
	return map[string]any{
		"messaging_product": "whatsapp",
		"recipient_type":    "individual",
		"to":                Digits(m.To),
		"type":              "template",
		"template":          tmpl,
	}
}

// Send sends one template message and answers Meta's message id (wamid…).
// Accepted is not delivered: delivery arrives later as a callback.
func (c *Client) Send(ctx context.Context, phoneNumberID string, m Message) (string, error) {
	if m.Template == "" || m.Language == "" {
		return "", errors.New("whatsapp: a message names a template and its language")
	}
	if Digits(m.To) == "" {
		return "", errors.New("whatsapp: a message needs a number to go to")
	}
	return c.post(ctx, phoneNumberID, m.payload())
}

// SendText sends free text. Meta allows it only inside the 24 hours after
// the person last wrote to the number — an answer to STOP or HELP, never a
// notice out of the blue.
func (c *Client) SendText(ctx context.Context, phoneNumberID, to, text string) (string, error) {
	if Digits(to) == "" {
		return "", errors.New("whatsapp: a message needs a number to go to")
	}
	return c.post(ctx, phoneNumberID, map[string]any{
		"messaging_product": "whatsapp",
		"recipient_type":    "individual",
		"to":                Digits(to),
		"type":              "text",
		"text":              map[string]any{"body": text, "preview_url": false},
	})
}

func (c *Client) post(ctx context.Context, phoneNumberID string, payload map[string]any) (string, error) {
	var out struct {
		Messages []struct {
			ID string `json:"id"`
		} `json:"messages"`
	}
	// Escaped: an id with a slash in it must not become a different endpoint.
	if err := c.do(ctx, http.MethodPost, "/"+url.PathEscape(phoneNumberID)+"/messages", nil, payload, &out); err != nil {
		return "", err
	}
	if len(out.Messages) == 0 || out.Messages[0].ID == "" {
		return "", &Error{Message: "Meta accepted the message and named none"}
	}
	return out.Messages[0].ID, nil
}

// UploadMedia uploads a file for a later message (an image header) and
// answers its media id. Meta keeps it 30 days.
func (c *Client) UploadMedia(ctx context.Context, phoneNumberID, filename, mimeType string, data []byte) (string, error) {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	_ = w.WriteField("messaging_product", "whatsapp")
	_ = w.WriteField("type", mimeType)
	h := make(textproto.MIMEHeader)
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename=%q`, filename))
	h.Set("Content-Type", mimeType)
	part, err := w.CreatePart(h)
	if err != nil {
		return "", err
	}
	if _, err := part.Write(data); err != nil {
		return "", err
	}
	if err := w.Close(); err != nil {
		return "", err
	}
	var out struct {
		ID string `json:"id"`
	}
	if err := c.send(ctx, http.MethodPost, "/"+url.PathEscape(phoneNumberID)+"/media", nil, &buf, w.FormDataContentType(), &out); err != nil {
		return "", err
	}
	if out.ID == "" {
		return "", &Error{Message: "Meta accepted the upload and named no media id"}
	}
	return out.ID, nil
}

// do is the JSON request shape.
func (c *Client) do(ctx context.Context, method, path string, query url.Values, payload, out any) error {
	var body io.Reader
	contentType := ""
	if payload != nil {
		raw, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		body, contentType = bytes.NewReader(raw), "application/json"
	}
	return c.send(ctx, method, path, query, body, contentType, out)
}

// send is the one request. Meta's errors arrive as a JSON body with a
// message worth repeating — "(#132001) Template name does not exist" is
// actionable, and "Bad Request" is not.
func (c *Client) send(ctx context.Context, method, path string, query url.Values, body io.Reader, contentType string, out any) error {
	if strings.TrimSpace(c.token) == "" {
		return errors.New("whatsapp: no access token")
	}
	return c.request(ctx, method, path, query, body, contentType, "Bearer "+c.token, out)
}

// request is send with the Authorization header given ("" for none): the
// resumable upload wants "OAuth <token>", and the code exchange none.
func (c *Client) request(ctx context.Context, method, path string, query url.Values, body io.Reader, contentType, auth string, out any) error {
	u := c.baseURL + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, u, body)
	if err != nil {
		return err
	}
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	for k, v := range extraHeaders(ctx) {
		req.Header.Set(k, v)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	res, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("whatsapp: Meta unreachable: %w", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		var wrapped struct {
			Error struct {
				Message      string `json:"message"`
				Type         string `json:"type"`
				Code         int    `json:"code"`
				Subcode      int    `json:"error_subcode"`
				ErrorData    any    `json:"error_data"`
				ErrorUserMsg string `json:"error_user_msg"`
			} `json:"error"`
		}
		e := &Error{Status: res.StatusCode, Message: strings.TrimSpace(string(raw))}
		if json.Unmarshal(raw, &wrapped) == nil && wrapped.Error.Message != "" {
			e.Code, e.Subcode, e.Type, e.Message = wrapped.Error.Code, wrapped.Error.Subcode, wrapped.Error.Type, wrapped.Error.Message
			if wrapped.Error.ErrorUserMsg != "" {
				e.Message += ": " + wrapped.Error.ErrorUserMsg
			}
		}
		if e.Message == "" {
			e.Message = http.StatusText(res.StatusCode)
		}
		return e
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(raw, out)
}

/* ── values ── */

// Digits is a phone number as Meta names a WhatsApp user (wa_id): the
// digits of its E.164 form, no +, no spaces. "+27 82 555 0101" and
// "27825550101" are the same person.
func Digits(phone string) string {
	var b strings.Builder
	for _, r := range phone {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// MaxParam is the longest body parameter this package sends. Meta's limit
// for a whole body is 1,024 characters; a notice's one line has no business
// near it.
const MaxParam = 300

// Param makes text fit to be a template parameter. Meta refuses a parameter
// holding a newline or a tab, or more than four spaces in a row, and an
// empty one; so whitespace runs become one space, the ends are trimmed, an
// overlong one is cut with an ellipsis, and nothing at all becomes "-".
func Param(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if r := []rune(s); len(r) > MaxParam {
		s = strings.TrimSpace(string(r[:MaxParam-1])) + "…"
	}
	if s == "" {
		return "-"
	}
	return s
}

// Extra request headers ride on the context: one call (the resumable upload's
// file_offset) needs one, and a parameter on every request for it would be
// noise.
type headersKey struct{}

func withHeader(ctx context.Context, k, v string) context.Context {
	h := map[string]string{}
	for a, b := range extraHeaders(ctx) {
		h[a] = b
	}
	h[k] = v
	return context.WithValue(ctx, headersKey{}, h)
}

func extraHeaders(ctx context.Context) map[string]string {
	h, _ := ctx.Value(headersKey{}).(map[string]string)
	return h
}
