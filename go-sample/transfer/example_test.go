package transfer_test

import (
	"errors"
	"fmt"

	"example.com/bankingsample/money"
	"example.com/bankingsample/transfer"
)

func ExampleApply() {
	amount, err := money.Parse("25.50")
	if err != nil {
		fmt.Println("invalid amount:", err)
		return
	}

	source := transfer.Account{ID: "acct-1", OwnerID: "alice", Currency: "USD", Balance: 10_000}
	destination := transfer.Account{ID: "acct-2", OwnerID: "bob", Currency: "USD", Balance: 500}
	request := transfer.Request{
		CustomerID:           "alice",
		SourceAccountID:      "acct-1",
		DestinationAccountID: "acct-2",
		Amount:               amount,
	}

	result, err := transfer.Apply(request, source, destination)
	if err != nil {
		fmt.Println("transfer refused:", err)
		return
	}
	fmt.Println("source:", result.SourceBalance)
	fmt.Println("destination:", result.DestinationBalance)

	// A transfer larger than the balance is refused with a sentinel error.
	request.Amount = 20_000
	_, err = transfer.Apply(request, source, destination)
	fmt.Println("insufficient funds:", errors.Is(err, transfer.ErrInsufficientFunds))

	// Output:
	// source: 74.50
	// destination: 30.50
	// insufficient funds: true
}
