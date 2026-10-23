package transfer

import (
	"errors"
	"math"
	"strings"
	"testing"

	"example.com/bankingsample/money"
)

const (
	alice = "customer-alice"
	bob   = "customer-bob"
)

func aliceChecking(balance money.Cents) Account {
	return Account{ID: "acct-alice-checking", OwnerID: alice, Currency: "USD", Balance: balance}
}

func bobChecking(balance money.Cents) Account {
	return Account{ID: "acct-bob-checking", OwnerID: bob, Currency: "USD", Balance: balance}
}

func request(amount money.Cents) Request {
	return Request{
		CustomerID:           alice,
		SourceAccountID:      "acct-alice-checking",
		DestinationAccountID: "acct-bob-checking",
		Amount:               amount,
	}
}

func TestValidate(t *testing.T) {
	tests := []struct {
		name    string
		edit    func(*Request)
		wantErr error
	}{
		{"valid request", func(*Request) {}, nil},
		{"smallest amount", func(r *Request) { r.Amount = 1 }, nil},
		{"largest amount", func(r *Request) { r.Amount = MaxAmount }, nil},
		{"zero amount", func(r *Request) { r.Amount = 0 }, ErrNonPositiveAmount},
		{"negative amount", func(r *Request) { r.Amount = -100 }, ErrNonPositiveAmount},
		{"above the limit", func(r *Request) { r.Amount = MaxAmount + 1 }, ErrAmountTooLarge},
		{"max int64", func(r *Request) { r.Amount = math.MaxInt64 }, ErrAmountTooLarge},
		{"missing customer", func(r *Request) { r.CustomerID = "" }, ErrMissingCustomerID},
		{"missing source", func(r *Request) { r.SourceAccountID = "" }, ErrMissingAccountID},
		{"missing destination", func(r *Request) { r.DestinationAccountID = "" }, ErrMissingAccountID},
		{"same account", func(r *Request) { r.DestinationAccountID = r.SourceAccountID }, ErrSameAccount},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := request(1000)
			tt.edit(&r)

			// errors.Is(err, nil) is true only when err is nil.
			if err := r.Validate(); !errors.Is(err, tt.wantErr) {
				t.Errorf("Validate() error = %v, want %v", err, tt.wantErr)
			}
		})
	}
}

func TestApplyMovesTheAmount(t *testing.T) {
	got, err := Apply(request(2550), aliceChecking(10_000), bobChecking(500))
	if err != nil {
		t.Fatalf("Apply returned error: %v", err)
	}

	want := Result{SourceBalance: 7_450, DestinationBalance: 3_050}
	if got != want {
		t.Errorf("Apply = %+v, want %+v", got, want)
	}
}

func TestApplyAllowsTransferringTheWholeBalance(t *testing.T) {
	got, err := Apply(request(10_000), aliceChecking(10_000), bobChecking(0))
	if err != nil {
		t.Fatalf("Apply returned error: %v", err)
	}
	if got.SourceBalance != 0 || got.DestinationBalance != 10_000 {
		t.Errorf("Apply = %+v, want source 0 and destination 10000", got)
	}
}

func TestApplyConservesMoney(t *testing.T) {
	for _, tc := range []struct{ amount, source, destination money.Cents }{
		{1, 1, 0},
		{99, 1_000, 7},
		{MaxAmount, MaxAmount, MaxAmount},
		{12_345, 99_999, 0},
	} {
		got, err := Apply(request(tc.amount), aliceChecking(tc.source), bobChecking(tc.destination))
		if err != nil {
			t.Fatalf("Apply(%d from %d) returned error: %v", tc.amount, tc.source, err)
		}
		if got.SourceBalance+got.DestinationBalance != tc.source+tc.destination {
			t.Errorf("money not conserved: before %d, after %d",
				tc.source+tc.destination, got.SourceBalance+got.DestinationBalance)
		}
	}
}

func TestApplyRejections(t *testing.T) {
	tests := []struct {
		name        string
		request     Request
		source      Account
		destination Account
		wantErr     error
	}{
		{
			name:        "insufficient funds by one cent",
			request:     request(10_001),
			source:      aliceChecking(10_000),
			destination: bobChecking(0),
			wantErr:     ErrInsufficientFunds,
		},
		{
			name:        "empty source account",
			request:     request(1),
			source:      aliceChecking(0),
			destination: bobChecking(0),
			wantErr:     ErrInsufficientFunds,
		},
		{
			name:        "source owned by someone else",
			request:     Request{CustomerID: bob, SourceAccountID: "acct-alice-checking", DestinationAccountID: "acct-bob-checking", Amount: 100},
			source:      aliceChecking(10_000),
			destination: bobChecking(0),
			wantErr:     ErrSourceNotFound,
		},
		{
			name:        "loaded accounts do not match the request",
			request:     request(100),
			source:      bobChecking(10_000),
			destination: aliceChecking(0),
			wantErr:     ErrAccountMismatch,
		},
		{
			name:        "different currencies",
			request:     request(100),
			source:      aliceChecking(10_000),
			destination: Account{ID: "acct-bob-checking", OwnerID: bob, Currency: "EUR"},
			wantErr:     ErrCurrencyMismatch,
		},
		{
			name:        "negative stored balance",
			request:     request(100),
			source:      aliceChecking(-1),
			destination: bobChecking(0),
			wantErr:     ErrInvalidBalance,
		},
		{
			name:        "destination balance would overflow",
			request:     request(10),
			source:      aliceChecking(10_000),
			destination: bobChecking(math.MaxInt64 - 5),
			wantErr:     ErrDestinationOverflow,
		},
		{
			name:        "invalid request is rejected before the accounts are inspected",
			request:     request(0),
			source:      aliceChecking(10_000),
			destination: bobChecking(0),
			wantErr:     ErrNonPositiveAmount,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Apply(tt.request, tt.source, tt.destination)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("Apply error = %v, want %v", err, tt.wantErr)
			}
			if got != (Result{}) {
				t.Errorf("Apply returned balances %+v alongside an error", got)
			}
		})
	}
}

func TestApplyDoesNotModifyItsInputs(t *testing.T) {
	source, destination := aliceChecking(10_000), bobChecking(500)

	if _, err := Apply(request(2_500), source, destination); err != nil {
		t.Fatalf("Apply returned error: %v", err)
	}

	if source.Balance != 10_000 || destination.Balance != 500 {
		t.Errorf("inputs changed: source %d, destination %d", source.Balance, destination.Balance)
	}
}

func TestErrorMessagesDoNotRevealBalances(t *testing.T) {
	_, err := Apply(request(10_001), aliceChecking(10_000), bobChecking(424_242))
	if err == nil {
		t.Fatal("expected an error")
	}
	for _, balance := range []string{"10000", "100.00", "424242", "4242.42"} {
		if strings.Contains(err.Error(), balance) {
			t.Errorf("error %q reveals a balance (%s)", err, balance)
		}
	}
}
