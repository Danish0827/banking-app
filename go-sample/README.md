# Go sample: transfer validation and money handling

A small, self-contained Go module showing how the transfer rules of this banking app can be
expressed in Go. It is an illustrative code sample added for review. It is **not** a replacement
for the application's backend, which remains the Node.js/TypeScript service in `../backend`, and
it is not a complete banking system: there is no HTTP API, database, persistence or locking here.

## What it covers

- **`money`**: amounts as integer minor units (`money.Cents`, an `int64`), parsing decimal text
  such as `"12.34"` into cents without floating point, overflow-checked addition, and formatting.
- **`transfer`**: validating a transfer request and computing the resulting balances.
  - The amount must be a positive whole number of cents, at most `MaxAmount` (1,000,000.00, the
    same per-operation limit as the TypeScript backend).
  - Source and destination IDs must both be present and different.
  - The source account must belong to the requesting customer. Someone else's account is
    reported as "not found", so the error does not reveal who owns it.
  - Currencies must match, stored balances must not be negative, and the destination balance must
    not overflow.
  - Insufficient funds are refused; transferring the entire balance is allowed.

## Prerequisites

- Go 1.22 or newer (`go version`)
- No third-party dependencies: only the standard library is used.

## Running the tests

From this directory:

```bash
go test ./...
```

For verbose output, or to also run the `go vet` checks:

```bash
go test -v ./...
go vet ./...
```

The tests are standard-library table-driven unit tests, plus a runnable `ExampleApply` in
`transfer/example_test.go` whose printed output is checked by `go test`.

## Design decisions

- **Integer cents, never floats.** `money.Parse("0.29")` is exactly `29`; with float64,
  `0.29 * 100` is `28.999…`. The whole and fractional parts are parsed separately as integers.
- **Strict parsing.** Signs, exponents, thousands separators, currency symbols and more than two
  fraction digits are rejected rather than guessed at.
- **Overflow is an error.** Parsing and adding check the `int64` range explicitly instead of
  wrapping around.
- **Pure functions.** `transfer.Apply` takes accounts by value and returns new balances; it never
  modifies its inputs. Loading accounts, locking rows and saving the result belong to the caller,
  as they do in the TypeScript backend's database transaction.
- **Sentinel errors.** Every rejection is an exported error variable, so callers branch with
  `errors.Is`. Messages add context such as the requested amount but never include balances.
- **Identity from the session.** `Request.CustomerID` is documented as coming from the
  authenticated session, never from client input.

## Limitations

- Illustrative only: no persistence, concurrency control, idempotency or ledger. In the real
  application those live in PostgreSQL transactions with row locks (see the main README).
- Account IDs are compared exactly; callers are expected to normalise them first.
- One currency per transfer; there is no exchange-rate handling.
- `money.Cents` uses `int64`, so amounts are bounded by its range (about 92 quadrillion cents).
