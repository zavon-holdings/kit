// Package bands reads a score against a scale's bands: the label, the tone
// and any recommendation a value earns. The bands are defined by whoever
// holds the scale; the score is worked out where its data lives; this is the
// one function both sides use to say which band a value is in, held to the
// vectors in contract/bands.
package bands

import (
	"errors"
	"math"
	"sort"
)

// Tones a band may carry, from best to worst.
const (
	ToneGood     = "good"
	ToneOK       = "ok"
	ToneWarning  = "warning"
	ToneCritical = "critical"
)

// Band is one step of a scale: every value at or above MinValue, and below
// the next band's MinValue, is in it.
type Band struct {
	MinValue       float64 `json:"min_value"`
	Label          string  `json:"label"`
	Tone           string  `json:"tone"`
	Recommendation string  `json:"recommendation"`
}

// Scale is a named measure and its bands, in any order.
type Scale struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Unit  string `json:"unit"`
	Bands []Band `json:"bands"`
}

// Errors a scale can have. Their codes are the vectors' "error" values.
var (
	ErrDuplicateMinValue = errors.New("duplicate_min_value")
	ErrUnknownTone       = errors.New("unknown_tone")
)

// Check says whether a scale can be read: every tone known, no two bands
// starting at the same value.
func Check(s Scale) error {
	seen := map[float64]bool{}
	for _, b := range s.Bands {
		switch b.Tone {
		case ToneGood, ToneOK, ToneWarning, ToneCritical:
		default:
			return ErrUnknownTone
		}
		if seen[b.MinValue] {
			return ErrDuplicateMinValue
		}
		seen[b.MinValue] = true
	}
	return nil
}

// Of is the band a value is in: the one with the highest MinValue at or
// below it. A value below every band, a scale with none, or a value that is
// not a number is in no band (nil, no error).
func Of(s Scale, value float64) (*Band, error) {
	if err := Check(s); err != nil {
		return nil, err
	}
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return nil, nil
	}
	sorted := append([]Band(nil), s.Bands...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].MinValue > sorted[j].MinValue })
	for i := range sorted {
		if value >= sorted[i].MinValue {
			b := sorted[i]
			return &b, nil
		}
	}
	return nil, nil
}
