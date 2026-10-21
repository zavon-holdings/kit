package whatsapp

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func sign(secret string, body []byte) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write(body)
	return "sha256=" + hex.EncodeToString(m.Sum(nil))
}

func TestVerifySignature(t *testing.T) {
	body := []byte(`{"object":"whatsapp_business_account"}`)
	good := sign("s3cret", body)
	cases := []struct {
		name, secret, header string
		want                 bool
	}{
		{"good", "s3cret", good, true},
		{"upper-case header", "s3cret", strings.ToUpper(good), true},
		{"wrong secret", "other", good, false},
		{"no secret refuses everything", "", good, false},
		{"missing header", "s3cret", "", false},
		{"no prefix", "s3cret", strings.TrimPrefix(good, "sha256="), false},
		{"sha1", "s3cret", "sha1=abc", false},
	}
	for _, c := range cases {
		if got := VerifySignature(c.secret, body, c.header); got != c.want {
			t.Errorf("%s: got %v", c.name, got)
		}
	}
	if VerifySignature("s3cret", append(body, ' '), good) {
		t.Error("a changed body still verified")
	}
}

func TestChallenge(t *testing.T) {
	if c, ok := Challenge("tok", "subscribe", "tok", "123"); !ok || c != "123" {
		t.Fatalf("good handshake: %q %v", c, ok)
	}
	for _, c := range [][4]string{{"", "subscribe", "", "1"}, {"tok", "unsubscribe", "tok", "1"}, {"tok", "subscribe", "nope", "1"}} {
		if _, ok := Challenge(c[0], c[1], c[2], c[3]); ok {
			t.Errorf("accepted %v", c)
		}
	}
}

func TestParseStatusesAndMessages(t *testing.T) {
	body := `{"object":"whatsapp_business_account","entry":[{"id":"WABA1","changes":[
	 {"field":"messages","value":{"metadata":{"phone_number_id":"PN1"},
	  "statuses":[{"id":"wamid.A","status":"delivered","recipient_id":"27825550101"},
	              {"id":"wamid.B","status":"failed","recipient_id":"27825550102","errors":[{"code":131026,"title":"Message undeliverable"}]}],
	  "contacts":[{"wa_id":"27825550101","profile":{"name":"Thandi"}}],
	  "messages":[{"id":"wamid.IN1","from":"27825550101","timestamp":"1760000000","type":"text","text":{"body":" stop "}},
	              {"id":"wamid.IN2","from":"27825550101","timestamp":"1760000001","type":"button","button":{"text":"Open","payload":"open:1"},"context":{"id":"wamid.A"}}]}},
	 {"field":"message_template_status_update","value":{"event":"APPROVED","message_template_id":123456789012,"message_template_name":"zavon_task","message_template_language":"en","reason":"NONE"}},
	 {"field":"something_new","value":{"x":1}}
	]}]}`
	events, err := Parse([]byte(body))
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 5 {
		t.Fatalf("events: %+v", events)
	}
	if e := events[1]; e.Kind != EventMessageStatus || e.MessageStatus != "failed" || e.FailureCode != 131026 {
		t.Errorf("failed status: %+v", e)
	}
	if e := events[2]; e.Kind != EventMessageIn || e.From != "27825550101" || e.Name != "Thandi" || Keyword(e.Text) != "stop" || e.Timestamp != 1760000000 {
		t.Errorf("text in: %+v", e)
	}
	if e := events[3]; e.Payload != "open:1" || e.Context != "wamid.A" {
		t.Errorf("button in: %+v", e)
	}
	if e := events[4]; e.TemplateID != "123456789012" || e.TemplateStatus != "APPROVED" {
		t.Errorf("template: %+v", e)
	}
}

func TestKeyword(t *testing.T) {
	for in, want := range map[string]string{
		"STOP": "stop", "stop.": "stop", " Stop  all ": "stop", "unsubscribe": "stop",
		"Start": "start", "UNSTOP": "start", "help": "help", "HELP!": "help",
		"yes": "", "cancel": "", "stop sending me the youth camp ones": "", "": "",
	} {
		if got := Keyword(in); got != want {
			t.Errorf("Keyword(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestParamAndDigits(t *testing.T) {
	if got := Param("  line one\n\tline   two     three "); got != "line one line two three" {
		t.Errorf("Param: %q", got)
	}
	if Param("   ") != "-" {
		t.Error("an empty parameter must not be sent empty")
	}
	if r := []rune(Param(strings.Repeat("a", 500))); len(r) != MaxParam || r[len(r)-1] != '…' {
		t.Errorf("long param: %d", len(r))
	}
	if Digits("+27 (82) 555-0101") != "27825550101" {
		t.Error("Digits")
	}
}

type seen struct {
	method, path, auth, ctype string
	body                      map[string]any
	raw                       []byte
}

func meta(t *testing.T, status int, answer string) (*Client, *seen) {
	t.Helper()
	s := &seen{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.method, s.path, s.auth, s.ctype = r.Method, r.URL.Path, r.Header.Get("Authorization"), r.Header.Get("Content-Type")
		s.raw, _ = io.ReadAll(r.Body)
		_ = json.Unmarshal(s.raw, &s.body)
		w.WriteHeader(status)
		_, _ = io.WriteString(w, answer)
	}))
	t.Cleanup(srv.Close)
	return New("tok", WithBaseURL(srv.URL+"/v21.0")), s
}

func TestSendTemplateWithButtonAndHeader(t *testing.T) {
	c, s := meta(t, 200, `{"messages":[{"id":"wamid.X"}]}`)
	id, err := c.Send(context.Background(), "PN1", Message{
		To: "+27 82 555 0101", Template: "zavon_task", Language: "en",
		Body: []string{"Shofar", "Call the new visitor"}, ImageLink: "https://x/y.png",
		URLButtons: map[int]string{0: "abc"},
	})
	if err != nil || id != "wamid.X" {
		t.Fatalf("%q %v", id, err)
	}
	if s.path != "/v21.0/PN1/messages" || s.auth != "Bearer tok" {
		t.Errorf("request: %s %s", s.path, s.auth)
	}
	if s.body["to"] != "27825550101" {
		t.Errorf("to: %v", s.body["to"])
	}
	comps := s.body["template"].(map[string]any)["components"].([]any)
	if len(comps) != 3 {
		t.Fatalf("components: %s", s.raw)
	}
	btn := comps[2].(map[string]any)
	if btn["sub_type"] != "url" || btn["index"] != "0" {
		t.Errorf("button: %v", btn)
	}
}

func TestSendAuthenticationCode(t *testing.T) {
	c, s := meta(t, 200, `{"messages":[{"id":"wamid.C"}]}`)
	if _, err := c.Send(context.Background(), "PN1", Message{To: "27825550101", Template: "zavon_signin_code", Language: "en", Code: "482913"}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(s.raw), `{"parameters":[{"text":"482913","type":"text"}],"type":"body"}`) ||
		!strings.Contains(string(s.raw), `"index":"0","parameters":[{"text":"482913","type":"text"}],"sub_type":"url"`) {
		t.Errorf("the code must fill the body and the copy-code button: %s", s.raw)
	}
}

func TestErrorsCarryMetaCode(t *testing.T) {
	c, _ := meta(t, 400, `{"error":{"message":"Template name does not exist in the translation","type":"OAuthException","code":132001,"error_subcode":2494073}}`)
	_, err := c.Send(context.Background(), "PN1", Message{To: "1", Template: "nope", Language: "en"})
	if CodeOf(err) != 132001 || !strings.Contains(err.Error(), "#132001") {
		t.Errorf("error: %v", err)
	}
	if _, err := New("").Number(context.Background(), "x"); err == nil {
		t.Error("no token must refuse before calling Meta")
	}
}

func TestSubscribeOverride(t *testing.T) {
	c, s := meta(t, 200, `{"success":true}`)
	if err := c.Subscribe(context.Background(), "WABA1", "https://core.example/webhooks/whatsapp", "vt"); err != nil {
		t.Fatal(err)
	}
	if s.path != "/v21.0/WABA1/subscribed_apps" || s.body["override_callback_uri"] != "https://core.example/webhooks/whatsapp" || s.body["verify_token"] != "vt" {
		t.Errorf("subscribe: %s %s", s.path, s.raw)
	}
}

func TestUploadMedia(t *testing.T) {
	c, s := meta(t, 200, `{"id":"MEDIA1"}`)
	id, err := c.UploadMedia(context.Background(), "PN1", "card.png", "image/png", []byte("PNG"))
	if err != nil || id != "MEDIA1" {
		t.Fatalf("%q %v", id, err)
	}
	if !strings.HasPrefix(s.ctype, "multipart/form-data") || !strings.Contains(string(s.raw), "messaging_product") || !strings.Contains(string(s.raw), "PNG") {
		t.Errorf("upload: %s %s", s.ctype, s.raw)
	}
}

func TestTemplatesFollowsPages(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Query().Get("after") == "" {
			_, _ = io.WriteString(w, `{"data":[{"name":"a","status":"APPROVED"}],"paging":{"cursors":{"after":"C1"},"next":"https://next"}}`)
			return
		}
		_, _ = io.WriteString(w, `{"data":[{"name":"b","status":"PENDING"}],"paging":{"cursors":{"after":"C2"}}}`)
	}))
	defer srv.Close()
	ts, err := New("tok", WithBaseURL(srv.URL)).Templates(context.Background(), "WABA1")
	if err != nil || len(ts) != 2 || calls != 2 {
		t.Fatalf("%v %v %d", ts, err, calls)
	}
}
