// Package neutralcopy guards kit's wording: kit is shared by every product
// and published, so its examples, defaults, fixtures and tests speak to any
// organisation. An app that serves churches gets church words from its own
// nomenclature settings, never from kit.
package neutralcopy

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// churchWords are the nouns a product would only use for a church. Matched
// on word starts, so "administrator" is not "ministry".
var churchWords = regexp.MustCompile(`(?i)\b(church(es)?|congregations?|ministr(y|ies)|campus(es)?|pastor(al|s)?|sermons?|tithes?|statement of faith|worship|parish(es)?|diocese)\b`)

// allowed names a file (slash path from the repository root) and the exact
// word it may hold, with why. Empty: kit has no reason to say any of these.
var allowed = map[string][]string{}

func TestKitSpeaksToEveryOrganisation(t *testing.T) {
	root, err := filepath.Abs(filepath.Join("..", "..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "contract")); err != nil {
		t.Fatalf("%s is not kit's root: %v", root, err)
	}
	scanned := 0
	err = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		name := d.Name()
		if d.IsDir() {
			switch name {
			case ".git", "node_modules", "dist", "build", "coverage":
				return filepath.SkipDir
			}
			return nil
		}
		if name == "package-lock.json" || !textFile(name) {
			return nil
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		rel = filepath.ToSlash(rel)
		if rel == "go/internal/neutralcopy/neutral_test.go" {
			return nil // the guard names what it guards against
		}
		scanned++
		for i, line := range strings.Split(string(b), "\n") {
			for _, m := range churchWords.FindAllString(line, -1) {
				if !allowedWord(rel, m) {
					t.Errorf("%s:%d says %q; kit's copy is for every organisation — use a neutral word (Location, Programme, Team)", rel, i+1, m)
				}
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if scanned < 50 {
		t.Fatalf("scanned only %d files under %s; the walk is not seeing kit", scanned, root)
	}
}

func textFile(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".go", ".ts", ".tsx", ".js", ".mjs", ".json", ".md", ".css", ".html", ".yml", ".yaml", ".txt", ".sql":
		return true
	}
	return false
}

func allowedWord(rel, word string) bool {
	for _, w := range allowed[rel] {
		if strings.EqualFold(w, word) {
			return true
		}
	}
	return false
}

// The guard must catch what it is for, and not trip on the words it would
// confuse them with.
func TestTheGuardsPattern(t *testing.T) {
	for _, s := range []string{"Pastoral note", "a campus", "Ministries", "the church", "Sermons"} {
		if !churchWords.MatchString(s) {
			t.Errorf("%q passed the guard", s)
		}
	}
	for _, s := range []string{"administrator", "Administration", "giving focus back", "offering a button", "campsite"} {
		if churchWords.MatchString(s) {
			t.Errorf("%q tripped the guard", s)
		}
	}
}
