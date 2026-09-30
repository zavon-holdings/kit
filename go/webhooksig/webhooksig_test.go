package webhooksig

import (
	"encoding/json"
	"errors"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

var (
	now  = time.Unix(1790000000, 0)
	body = []byte(`{"action":"pages.publish","attempt":1}`)
)

// Computed independently (python3 hmac/hashlib), so a change to the preimage
// on this side cannot pass by agreeing with itself. It is also what core's
// auth.Sign returns for the same input.
const coreSig = "2404dff02b09fa87975a446c6672be2be1e54cd8ccbb504d053f0ec429731fe0"

func TestSignIsCoresBareHex(t *testing.T) {
	if got := Sign("s3cret", 1790000000, body); got != coreSig {
		t.Fatalf("Sign = %s, want core's %s", got, coreSig)
	}
}

func TestVerifyAcceptsCoresBareHex(t *testing.T) {
	if err := Verify([]string{"s3cret"}, coreSig, "1790000000", body, now); err != nil {
		t.Fatal(err)
	}
}

func TestVerifyAcceptsAV1Header(t *testing.T) {
	h := Header([]string{"s3cret"}, now.Unix(), body)
	if h != "v1="+coreSig {
		t.Fatalf("Header = %q", h)
	}
	if err := Verify([]string{"s3cret"}, h, "1790000000", body, now); err != nil {
		t.Fatal(err)
	}
}

func TestSkewIsRefusedBothWays(t *testing.T) {
	for _, d := range []time.Duration{MaxSkew + time.Second, -MaxSkew - time.Second} {
		ts := now.Add(d).Unix()
		h := Header([]string{"k"}, ts, body)
		if err := Verify([]string{"k"}, h, strconv.FormatInt(ts, 10), body, now); !errors.Is(err, ErrSkew) {
			t.Errorf("skew %v: err = %v, want ErrSkew", d, err)
		}
	}
	ts := now.Add(MaxSkew - time.Second).Unix()
	if err := Verify([]string{"k"}, Header([]string{"k"}, ts, body), strconv.FormatInt(ts, 10), body, now); err != nil {
		t.Errorf("inside the window refused: %v", err)
	}
}

func TestRotationAcceptsThePreviousSecret(t *testing.T) {
	// Core signed with both; the app has only updated to the new one — or has
	// not updated yet. Either side of the overlap must verify.
	h := Header([]string{"new", "old"}, now.Unix(), body)
	if !strings.Contains(h, ", v1=") {
		t.Fatalf("rotation header is not a list: %q", h)
	}
	for _, holds := range [][]string{{"new"}, {"old"}, {"new", "old"}} {
		if err := Verify(holds, h, "1790000000", body, now); err != nil {
			t.Errorf("app holding %v refused: %v", holds, err)
		}
	}
	// And an app holding both accepts core signing with only the old one.
	if err := Verify([]string{"new", "old"}, Header([]string{"old"}, now.Unix(), body), "1790000000", body, now); err != nil {
		t.Errorf("previous secret refused: %v", err)
	}
}

func TestATamperedBodyIsRefused(t *testing.T) {
	h := Header([]string{"k"}, now.Unix(), body)
	tampered := []byte(strings.Replace(string(body), "1", "2", 1))
	if err := Verify([]string{"k"}, h, "1790000000", tampered, now); !errors.Is(err, ErrMismatch) {
		t.Fatalf("err = %v, want ErrMismatch", err)
	}
	if err := Verify([]string{"other"}, h, "1790000000", body, now); !errors.Is(err, ErrMismatch) {
		t.Fatalf("wrong secret: err = %v", err)
	}
}

func TestMissingHeadersAreRefused(t *testing.T) {
	h := Header([]string{"k"}, now.Unix(), body)
	if err := Verify([]string{"k"}, "", "1790000000", body, now); !errors.Is(err, ErrMissing) {
		t.Errorf("no signature: %v", err)
	}
	if err := Verify([]string{"k"}, h, "", body, now); !errors.Is(err, ErrMissing) {
		t.Errorf("no timestamp: %v", err)
	}
	if err := Verify([]string{"k"}, h, "yesterday", body, now); !errors.Is(err, ErrBadTimestamp) {
		t.Errorf("bad timestamp: %v", err)
	}
}

func TestNoSecretFailsClosed(t *testing.T) {
	h := Header([]string{"k"}, now.Unix(), body)
	for _, secrets := range [][]string{nil, {}, {""}} {
		if err := Verify(secrets, h, "1790000000", body, now); !errors.Is(err, ErrNoSecret) {
			t.Errorf("secrets %q: err = %v, want ErrNoSecret", secrets, err)
		}
	}
	if Header([]string{""}, now.Unix(), body) != "" {
		t.Error("an empty secret produced a signature")
	}
}

func TestAnUnknownVersionIsNotTried(t *testing.T) {
	// v2=<the v1 hex> must not verify: a later scheme's value is not this one's.
	if err := Verify([]string{"s3cret"}, "v2="+coreSig, "1790000000", body, now); !errors.Is(err, ErrMismatch) {
		t.Fatalf("err = %v", err)
	}
}

func TestVerifyRequestRoundTrip(t *testing.T) {
	r := httptest.NewRequest("POST", "/api/workflow/actions", strings.NewReader(string(body)))
	SignRequest(r, []string{"k"}, body, now)
	got, err := VerifyRequest(r, []string{"k"}, now)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(body) {
		t.Fatalf("body = %q", got)
	}
	r = httptest.NewRequest("POST", "/", strings.NewReader(string(body)+" "))
	SignRequest(r, []string{"k"}, body, now)
	if _, err := VerifyRequest(r, []string{"k"}, now); !errors.Is(err, ErrMismatch) {
		t.Fatalf("altered body: %v", err)
	}
}

/* ── contract vectors ── */

// Vector is one case in contract/signature/*.json. The same files are read by
// the TypeScript twin and by every consumer's CI.
type Vector struct {
	Name      string   `json:"name"`
	Secrets   []string `json:"secrets"`
	Timestamp int64    `json:"timestamp"`
	Body      string   `json:"body"`
	Sign      string   `json:"sign"`   // Sign(secrets[0], timestamp, body)
	Header    string   `json:"header"` // Header(secrets, timestamp, body)
}

func vectorCases() []Vector {
	return []Vector{
		{Name: "bare", Secrets: []string{"s3cret"}, Timestamp: 1790000000, Body: string(body)},
		{Name: "empty-body", Secrets: []string{"s3cret"}, Timestamp: 1790000000, Body: ""},
		{Name: "rotation", Secrets: []string{"new-secret", "old-secret"}, Timestamp: 1790000123,
			Body: `{"action":"shop.fulfilment.transition","input":{"to":"packed"}}`},
		{Name: "unicode", Secrets: []string{"k"}, Timestamp: 1790000456, Body: `{"label":"Kérk — Paasfees 🌅"}`},
	}
}

// KIT_WRITE_VECTORS=1 go test ./webhooksig -run TestContractVectors rewrites
// the files; otherwise the files are checked against this implementation.
func TestContractVectors(t *testing.T) {
	dir := filepath.Join("..", "..", "contract", "signature")
	if os.Getenv("KIT_WRITE_VECTORS") == "1" {
		for _, v := range vectorCases() {
			v.Sign = Sign(v.Secrets[0], v.Timestamp, []byte(v.Body))
			v.Header = Header(v.Secrets, v.Timestamp, []byte(v.Body))
			raw, _ := json.MarshalIndent(v, "", "  ")
			if err := os.WriteFile(filepath.Join(dir, v.Name+".json"), append(raw, '\n'), 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}
	files, err := filepath.Glob(filepath.Join(dir, "*.json"))
	if err != nil || len(files) == 0 {
		t.Fatalf("no vectors in %s (%v)", dir, err)
	}
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		var v Vector
		if err := json.Unmarshal(raw, &v); err != nil {
			t.Fatalf("%s: %v", f, err)
		}
		if got := Sign(v.Secrets[0], v.Timestamp, []byte(v.Body)); got != v.Sign {
			t.Errorf("%s: Sign = %s, want %s", v.Name, got, v.Sign)
		}
		if got := Header(v.Secrets, v.Timestamp, []byte(v.Body)); got != v.Header {
			t.Errorf("%s: Header = %s, want %s", v.Name, got, v.Header)
		}
		at := time.Unix(v.Timestamp, 0)
		for _, s := range v.Secrets {
			if err := Verify([]string{s}, v.Header, strconv.FormatInt(v.Timestamp, 10), []byte(v.Body), at); err != nil {
				t.Errorf("%s: holder of one secret refused: %v", v.Name, err)
			}
		}
	}
}
