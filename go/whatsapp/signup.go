package whatsapp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

// Embedded Signup and template examples: the calls an onboarding and a
// template with a picture header need beyond sending.
//
// Meta's order after an organisation finishes Embedded Signup is: exchange
// the code (it lives 30 seconds, so at once and server to server), subscribe
// the app to the account (Subscribe), register the number with a PIN.

// ExchangeCode trades the code Embedded Signup hands the browser for the
// organisation's business token. It needs the app's id and secret, never a
// token, so it may be called on a client built with an empty one.
func (c *Client) ExchangeCode(ctx context.Context, appID, appSecret, code string) (string, error) {
	if strings.TrimSpace(appID) == "" || strings.TrimSpace(appSecret) == "" {
		return "", errors.New("whatsapp: exchanging a signup code needs the app id and secret")
	}
	if strings.TrimSpace(code) == "" {
		return "", errors.New("whatsapp: no signup code to exchange")
	}
	q := url.Values{"client_id": {appID}, "client_secret": {appSecret}, "code": {code}}
	var raw json.RawMessage
	if err := c.request(ctx, http.MethodGet, "/oauth/access_token", q, nil, "", "", &raw); err != nil {
		return "", err
	}
	// Documented as the token in plain text; Graph answers JSON. Both.
	var out struct {
		AccessToken string `json:"access_token"`
	}
	if json.Unmarshal(raw, &out) == nil && out.AccessToken != "" {
		return out.AccessToken, nil
	}
	var s string
	if json.Unmarshal(raw, &s) == nil && s != "" {
		return s, nil
	}
	return "", &Error{Message: "Meta exchanged the code and named no token"}
}

var pinShape = regexp.MustCompile(`^[0-9]{6}$`)

// Register registers a number for the Cloud API with its two-step
// verification PIN (six digits), which the caller keeps: Meta asks for it
// again if the number is ever registered elsewhere.
func (c *Client) Register(ctx context.Context, phoneNumberID, pin string) error {
	if !pinShape.MatchString(pin) {
		return errors.New("whatsapp: a registration PIN is six digits")
	}
	var out struct {
		Success bool `json:"success"`
	}
	body := map[string]any{"messaging_product": "whatsapp", "pin": pin}
	if err := c.do(ctx, http.MethodPost, "/"+url.PathEscape(phoneNumberID)+"/register", nil, body, &out); err != nil {
		return err
	}
	if !out.Success {
		return &Error{Message: "the registration was not confirmed"}
	}
	return nil
}

// UploadHandle uploads a file through the Resumable Upload API and answers
// its handle — what a template's media header names as its example
// (`example.header_handle`). Not UploadMedia: that is a media id for a
// message, and Meta refuses one as an example.
func (c *Client) UploadHandle(ctx context.Context, appID, fileName, mimeType string, data []byte) (string, error) {
	if strings.TrimSpace(c.token) == "" {
		return "", errors.New("whatsapp: no access token")
	}
	if strings.TrimSpace(appID) == "" {
		return "", errors.New("whatsapp: an upload handle needs the app id")
	}
	if len(data) == 0 {
		return "", errors.New("whatsapp: nothing to upload")
	}
	q := url.Values{"file_name": {fileName}, "file_length": {strconv.Itoa(len(data))}, "file_type": {mimeType}}
	var session struct {
		ID string `json:"id"`
	}
	if err := c.send(ctx, http.MethodPost, "/"+url.PathEscape(appID)+"/uploads", q, nil, "", &session); err != nil {
		return "", err
	}
	if !strings.HasPrefix(session.ID, "upload:") {
		return "", &Error{Message: "Meta opened no upload session"}
	}
	var out struct {
		H string `json:"h"`
	}
	path := "/" + session.ID // "upload:<id>", sent as it is
	if err := c.uploadAt(ctx, path, data, &out); err != nil {
		return "", err
	}
	if out.H == "" {
		return "", &Error{Message: "Meta accepted the upload and named no handle"}
	}
	return out.H, nil
}

func (c *Client) uploadAt(ctx context.Context, path string, data []byte, out any) error {
	ctx = withHeader(ctx, "file_offset", "0")
	return c.request(ctx, http.MethodPost, path, nil, bytes.NewReader(data), "application/octet-stream", "OAuth "+c.token, out)
}
