package emailcta

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestTheVectors(t *testing.T) {
	files, _ := filepath.Glob(filepath.Join("..", "..", "contract", "emailcta", "*.json"))
	if len(files) < 10 {
		t.Fatalf("only %d vectors", len(files))
	}
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		var v struct {
			Name, Button, Link, Body, Expect string
		}
		if err := json.Unmarshal(raw, &v); err != nil {
			t.Fatalf("%s: %v", f, err)
		}
		t.Run(v.Name, func(t *testing.T) {
			if got := Apply(v.Body, Templates{ButtonHTML: v.Button, LinkHTML: v.Link}); got != v.Expect {
				t.Fatalf("got\n%s\nwant\n%s", got, v.Expect)
			}
		})
	}
}

func TestTextAndEscape(t *testing.T) {
	if got := Text("  Book&nbsp;<b>&amp;</b>\n pay &#8212; &#x41; &bogus; "); got != "Book & pay — A &bogus;" {
		t.Fatalf("Text = %q", got)
	}
	if got := Escape(`<"Tom" & 'Jerry'>`); got != "&lt;&#34;Tom&#34; &amp; &#39;Jerry&#39;&gt;" {
		t.Fatalf("Escape = %q", got)
	}
}
