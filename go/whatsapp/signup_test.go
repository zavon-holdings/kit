package whatsapp

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type hit struct {
	method, path, query, auth, offset, body string
}

func recorder(t *testing.T, answer func(r *http.Request) (int, string)) (*Client, *[]hit) {
	t.Helper()
	var log []hit
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		log = append(log, hit{r.Method, r.URL.Path, r.URL.RawQuery, r.Header.Get("Authorization"), r.Header.Get("file_offset"), string(b)})
		code, body := answer(r)
		w.WriteHeader(code)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	return New("TOKEN", WithBaseURL(srv.URL+"/v21.0")), &log
}

func TestExchangeCodeSendsNoBearerAndReadsEitherShape(t *testing.T) {
	for _, answer := range []string{`{"access_token":"BIZ","token_type":"bearer"}`, `"BIZ"`} {
		c, log := recorder(t, func(*http.Request) (int, string) { return 200, answer })
		tok, err := New("", WithBaseURL(strings.TrimSuffix(c.baseURL, ""))).ExchangeCode(context.Background(), "APP", "SECRET", "CODE")
		if err != nil || tok != "BIZ" {
			t.Fatalf("%s: %q %v", answer, tok, err)
		}
		got := (*log)[0]
		if got.method != "GET" || got.path != "/v21.0/oauth/access_token" || got.auth != "" ||
			!strings.Contains(got.query, "client_id=APP") || !strings.Contains(got.query, "client_secret=SECRET") || !strings.Contains(got.query, "code=CODE") {
			t.Errorf("exchange: %+v", got)
		}
	}
	if _, err := New("").ExchangeCode(context.Background(), "", "s", "c"); err == nil {
		t.Error("no app id must refuse")
	}
}

func TestRegisterNeedsSixDigits(t *testing.T) {
	c, log := recorder(t, func(*http.Request) (int, string) { return 200, `{"success":true}` })
	if err := c.Register(context.Background(), "PN1", "12345"); err == nil {
		t.Error("five digits must refuse")
	}
	if len(*log) != 0 {
		t.Fatal("a refused PIN must not reach Meta")
	}
	if err := c.Register(context.Background(), "PN1", "123456"); err != nil {
		t.Fatal(err)
	}
	got := (*log)[0]
	if got.path != "/v21.0/PN1/register" || !strings.Contains(got.body, `"pin":"123456"`) || !strings.Contains(got.body, `"messaging_product":"whatsapp"`) {
		t.Errorf("register: %+v", got)
	}
}

func TestUploadHandleOpensASessionThenUploadsWithOAuth(t *testing.T) {
	c, log := recorder(t, func(r *http.Request) (int, string) {
		if strings.HasSuffix(r.URL.Path, "/uploads") {
			return 200, `{"id":"upload:SESSION1"}`
		}
		return 200, `{"h":"4::HANDLE"}`
	})
	h, err := c.UploadHandle(context.Background(), "APP", "card.png", "image/png", []byte("PNGDATA"))
	if err != nil || h != "4::HANDLE" {
		t.Fatalf("%q %v", h, err)
	}
	open, up := (*log)[0], (*log)[1]
	if open.path != "/v21.0/APP/uploads" || !strings.Contains(open.query, "file_length=7") || !strings.Contains(open.query, "file_type=image%2Fpng") || open.auth != "Bearer TOKEN" {
		t.Errorf("session: %+v", open)
	}
	if up.path != "/v21.0/upload:SESSION1" || up.auth != "OAuth TOKEN" || up.offset != "0" || up.body != "PNGDATA" {
		t.Errorf("upload: %+v", up)
	}
}
