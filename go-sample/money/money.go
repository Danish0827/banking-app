// Package money represents amounts as integer minor units (cents), so that
// all arithmetic is exact. It never uses floating point.
package money

import (
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// Cents is an amount of money in minor units: 1050 means 10.50.
type Cents int64

var (
	// ErrInvalidFormat is returned by Parse for text that is not a plain
	// non-negative decimal amount with at most two fraction digits.
	ErrInvalidFormat = errors.New("money: invalid amount format")

	// ErrOverflow is returned when a result would not fit in an int64.
	ErrOverflow = errors.New("money: amount out of range")
)

// Parse converts a decimal string such as "12", "12.5" or "12.34" into cents.
//
// The whole and fractional parts are parsed separately as integers, so "0.29"
// becomes exactly 29. Signs, exponents, thousands separators, currency symbols
// and more than two fraction digits are rejected rather than guessed at.
func Parse(text string) (Cents, error) {
	whole, fraction, hasPoint := strings.Cut(text, ".")
	if !isDigits(whole) || (hasPoint && (len(fraction) == 0 || len(fraction) > 2 || !isDigits(fraction))) {
		return 0, fmt.Errorf("%w: %q", ErrInvalidFormat, text)
	}

	units, err := strconv.ParseInt(whole, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("%w: %q", ErrOverflow, text)
	}

	var subunits int64
	if hasPoint {
		// Pad "5" to "50": one fraction digit means tenths, not cents.
		subunits, _ = strconv.ParseInt(fraction+strings.Repeat("0", 2-len(fraction)), 10, 64)
	}

	if units > (math.MaxInt64-subunits)/100 {
		return 0, fmt.Errorf("%w: %q", ErrOverflow, text)
	}
	return Cents(units*100 + subunits), nil
}

// Add returns a+b, or ErrOverflow if the sum does not fit in an int64.
func Add(a, b Cents) (Cents, error) {
	if (b > 0 && a > math.MaxInt64-b) || (b < 0 && a < math.MinInt64-b) {
		return 0, ErrOverflow
	}
	return a + b, nil
}

// String formats the amount with two decimal places, e.g. 1050 as "10.50"
// and -5 as "-0.05".
func (c Cents) String() string {
	sign := ""
	// Work in uint64 so that math.MinInt64 can be negated safely.
	magnitude := uint64(c)
	if c < 0 {
		sign = "-"
		magnitude = -magnitude
	}
	return fmt.Sprintf("%s%d.%02d", sign, magnitude/100, magnitude%100)
}

func isDigits(text string) bool {
	if text == "" {
		return false
	}
	for _, r := range text {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}
