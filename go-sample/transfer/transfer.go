// Package transfer validates an account-to-account transfer and computes the
// resulting balances. It is a pure function over its inputs: loading and
// locking accounts and persisting the result are the caller's job.
package transfer

import (
	"errors"
	"fmt"

	"example.com/bankingsample/money"
)

// MaxAmount is the largest single transfer: 1,000,000.00. It matches the
// per-operation limit of the TypeScript backend in this repository.
const MaxAmount money.Cents = 100_000_000

// Errors returned by Validate and Apply. Callers compare with errors.Is; the
// wrapped messages add context but never balances.
var (
	ErrMissingAccountID    = errors.New("transfer: source and destination account IDs are required")
	ErrMissingCustomerID   = errors.New("transfer: customer ID is required")
	ErrNonPositiveAmount   = errors.New("transfer: amount must be greater than zero")
	ErrAmountTooLarge      = errors.New("transfer: amount exceeds the per-transfer limit")
	ErrSameAccount         = errors.New("transfer: source and destination must be different accounts")
	ErrAccountMismatch     = errors.New("transfer: accounts do not match the request")
	ErrSourceNotFound      = errors.New("transfer: source account not found")
	ErrCurrencyMismatch    = errors.New("transfer: source and destination currencies differ")
	ErrInvalidBalance      = errors.New("transfer: account has an invalid balance")
	ErrInsufficientFunds   = errors.New("transfer: insufficient funds")
	ErrDestinationOverflow = errors.New("transfer: destination balance would overflow")
)

// Account is the state of an account at the moment of the transfer.
type Account struct {
	ID       string
	OwnerID  string
	Currency string
	Balance  money.Cents
}

// Request is a transfer as asked for by an authenticated customer.
// CustomerID must come from the caller's session, never from client input.
type Request struct {
	CustomerID           string
	SourceAccountID      string
	DestinationAccountID string
	Amount               money.Cents
}

// Result holds the balances after a successful transfer.
type Result struct {
	SourceBalance      money.Cents
	DestinationBalance money.Cents
}

// Validate checks the request on its own, before any account is loaded.
// IDs are compared exactly; callers should normalise them first (for example
// lower-casing UUIDs) so two spellings of one ID cannot slip through.
func (r Request) Validate() error {
	switch {
	case r.CustomerID == "":
		return ErrMissingCustomerID
	case r.SourceAccountID == "" || r.DestinationAccountID == "":
		return ErrMissingAccountID
	case r.SourceAccountID == r.DestinationAccountID:
		return ErrSameAccount
	case r.Amount <= 0:
		return fmt.Errorf("%w: got %s", ErrNonPositiveAmount, r.Amount)
	case r.Amount > MaxAmount:
		return fmt.Errorf("%w: got %s, limit %s", ErrAmountTooLarge, r.Amount, MaxAmount)
	}
	return nil
}

// Apply validates the transfer against both accounts and returns the new
// balances. The accounts are passed by value and never modified.
//
// A source account owned by someone else is reported exactly like one that
// does not exist (ErrSourceNotFound), so the error does not reveal who owns it.
func Apply(r Request, source, destination Account) (Result, error) {
	if err := r.Validate(); err != nil {
		return Result{}, err
	}
	if source.ID != r.SourceAccountID || destination.ID != r.DestinationAccountID {
		return Result{}, ErrAccountMismatch
	}
	if source.OwnerID != r.CustomerID {
		return Result{}, ErrSourceNotFound
	}
	if source.Currency != destination.Currency {
		return Result{}, ErrCurrencyMismatch
	}
	if source.Balance < 0 || destination.Balance < 0 {
		return Result{}, ErrInvalidBalance
	}
	if r.Amount > source.Balance {
		return Result{}, ErrInsufficientFunds
	}

	destinationBalance, err := money.Add(destination.Balance, r.Amount)
	if err != nil {
		return Result{}, ErrDestinationOverflow
	}

	return Result{
		SourceBalance:      source.Balance - r.Amount,
		DestinationBalance: destinationBalance,
	}, nil
}
