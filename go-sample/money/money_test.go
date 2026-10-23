package money

import (
	"errors"
	"math"
	"testing"
)

func TestParse(t *testing.T) {
	tests := []struct {
		input string
		want  Cents
	}{
		{"0", 0},
		{"10", 1000},
		{"10.5", 1050},
		{"10.50", 1050},
		{"0.01", 1},
		// Values that a float64 conversion (x * 100) gets wrong.
		{"0.29", 29},
		{"0.57", 57},
		{"1.00", 100},
		{"0001.20", 120},
		{"92233720368547758.07", math.MaxInt64},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got, err := Parse(tt.input)
			if err != nil {
				t.Fatalf("Parse(%q) returned error: %v", tt.input, err)
			}
			if got != tt.want {
				t.Errorf("Parse(%q) = %d, want %d", tt.input, got, tt.want)
			}
		})
	}
}

func TestParseRejectsInvalidFormats(t *testing.T) {
	for _, input := range []string{
		"", " ", "abc", "-1", "+1", "1.", ".5", "1.005", "1,000.00", "$5", "1e3", "1.2.3", "１０",
	} {
		t.Run(input, func(t *testing.T) {
			if _, err := Parse(input); !errors.Is(err, ErrInvalidFormat) {
				t.Errorf("Parse(%q) error = %v, want ErrInvalidFormat", input, err)
			}
		})
	}
}

func TestParseRejectsOverflow(t *testing.T) {
	for _, input := range []string{"92233720368547758.08", "92233720368547759", "99999999999999999999"} {
		t.Run(input, func(t *testing.T) {
			if _, err := Parse(input); !errors.Is(err, ErrOverflow) {
				t.Errorf("Parse(%q) error = %v, want ErrOverflow", input, err)
			}
		})
	}
}

func TestAdd(t *testing.T) {
	if got, err := Add(1050, 250); err != nil || got != 1300 {
		t.Errorf("Add(1050, 250) = %d, %v; want 1300, nil", got, err)
	}
	if got, err := Add(math.MaxInt64-1, 1); err != nil || got != math.MaxInt64 {
		t.Errorf("Add at the limit = %d, %v; want MaxInt64, nil", got, err)
	}
	for _, pair := range [][2]Cents{{math.MaxInt64, 1}, {math.MinInt64, -1}} {
		if _, err := Add(pair[0], pair[1]); !errors.Is(err, ErrOverflow) {
			t.Errorf("Add(%d, %d) error = %v, want ErrOverflow", pair[0], pair[1], err)
		}
	}
}

func TestString(t *testing.T) {
	tests := []struct {
		amount Cents
		want   string
	}{
		{0, "0.00"},
		{5, "0.05"},
		{1050, "10.50"},
		{250000, "2500.00"},
		{-5, "-0.05"},
		{math.MaxInt64, "92233720368547758.07"},
		{math.MinInt64, "-92233720368547758.08"},
	}
	for _, tt := range tests {
		if got := tt.amount.String(); got != tt.want {
			t.Errorf("Cents(%d).String() = %q, want %q", int64(tt.amount), got, tt.want)
		}
	}
}

func TestParseAndStringRoundTrip(t *testing.T) {
	for _, amount := range []Cents{0, 1, 99, 100, 1050, 123456789, math.MaxInt64} {
		parsed, err := Parse(amount.String())
		if err != nil || parsed != amount {
			t.Errorf("Parse(%q) = %d, %v; want %d", amount.String(), parsed, err, amount)
		}
	}
}
