package bands

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestTheVectors(t *testing.T) {
	files, _ := filepath.Glob(filepath.Join("..", "..", "contract", "bands", "*.json"))
	if len(files) < 10 {
		t.Fatalf("only %d vectors", len(files))
	}
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		var v struct {
			Name   string  `json:"name"`
			Scale  Scale   `json:"scale"`
			Value  float64 `json:"value"`
			Expect *Band   `json:"expect"`
			Error  string  `json:"error"`
		}
		if err := json.Unmarshal(raw, &v); err != nil {
			t.Fatalf("%s: %v", f, err)
		}
		t.Run(v.Name, func(t *testing.T) {
			got, err := Of(v.Scale, v.Value)
			if v.Error != "" {
				if err == nil || err.Error() != v.Error {
					t.Fatalf("error %v, want %s", err, v.Error)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, v.Expect) {
				t.Fatalf("got %+v, want %+v", got, v.Expect)
			}
		})
	}
}
