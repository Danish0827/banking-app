# Banking App

A simple banking web application: view accounts, deposit, withdraw, transfer between customers
and browse transaction history.

> **Status:** customers can sign in, view their own accounts, deposit, withdraw, transfer money
> to any account, and browse their transaction history.

## Tech stack

| Layer    | Technology                                                  |
| -------- | ----------------------------------------------------------- |
| Frontend | Next.js (App Router), React, TypeScript, Tailwind           |
| Backend  | Node.js, Express, TypeScript, Zod, Pino                     |
| Database | PostgreSQL, accessed with `pg` (no ORM), `node-pg-migrate`  |
| Testing  | Vitest + Supertest, against a real PostgreSQL test database |
| Tooling  | ESLint, Prettier, EditorConfig                              |

## Project structure

```
banking-app/
├── docker-compose.yml        PostgreSQL for local development and tests
├── docker/postgres/init/     One-off database initialisation scripts
├── backend/                  Express REST API
│   ├── migrations/           SQL migrations (node-pg-migrate)
│   ├── scripts/              One-off setup SQL for a local PostgreSQL
│   ├── src/
│   │   ├── config/           Environment parsing, logger
│   │   ├── db/               Pool, transaction helper, migration runner, seed
│   │   ├── errors/           Application error classes
│   │   ├── lib/              Shared helpers (password hashing)
│   │   ├── middleware/       Request logging, validation, auth, 404 and error handlers
│   │   ├── modules/          Feature modules: accounts, auth, customers, health, transactions
│   │   ├── routes/           Versioned API routers
│   │   ├── app.ts            Express app factory (no port binding; used by tests)
│   │   ├── lifecycle.ts      Shutdown state read by the readiness check
│   │   ├── shutdown.ts       Graceful shutdown on SIGTERM/SIGINT
│   │   └── server.ts         Process entry point
│   └── tests/
│       ├── integration/      Tests that run against the test database
│       ├── unit/
│       ├── helpers/          Fixtures and the guarded database reset
│       └── setup/            Test-run setup (migrations, pool teardown)
└── frontend/                 Next.js application
    └── src/
        ├── app/              Routes: login, and the signed-in pages under (app)/
        ├── components/
        └── lib/              API client, auth and account calls, formatting
```

## Prerequisites

- Node.js 22 or newer
- PostgreSQL 13 or newer: either Docker with Docker Compose, or a local installation

## Getting started

Run these from the `banking-app/` directory.

1. Install dependencies for the root, backend and frontend:

   ```bash
   npm run install:all
   ```

2. Create the local environment files:

   ```bash
   cp backend/.env.example backend/.env
   cp frontend/.env.example frontend/.env.local
   ```

3. Provide PostgreSQL, using **one** of these options.

   **Option A: Docker Compose.** Starts PostgreSQL on host port 5433 with the `bank_dev` and
   `bank_test` databases. `backend/.env` works unchanged.

   ```bash
   npm run db:up
   ```

   **Option B: local PostgreSQL.** Create the role and both databases once, as a superuser:

   ```bash
   psql -U postgres -f backend/scripts/create-local-databases.sql
   ```

   Then change the port in both connection strings in `backend/.env` from `5433` to your local
   port (usually `5432`).

4. Create the schema and load the demo data:

   ```bash
   npm run db:migrate
   npm run db:seed
   ```

5. Start the API (http://localhost:4000):

   ```bash
   npm run dev:backend
   ```

6. In a second terminal, start the web app (http://localhost:3000):

   ```bash
   npm run dev:frontend
   ```

Open http://localhost:3000 and sign in with one of the demo customers below. The dashboard lists
that customer's accounts; select one to see its details and move money. **Transactions** in the
header shows the customer's history.

### Demo data

`npm run db:seed` creates three customers, all with the password `Demo-Password-123`:

| Customer      | Email               | Account      | Type     | Opening balance | Account ID                             |
| ------------- | ------------------- | ------------ | -------- | --------------- | -------------------------------------- |
| Alice Johnson | `alice@example.com` | `1000000001` | checking | $2,500.00       | `00000000-0000-4000-8000-000000000101` |
|               |                     | `1000000002` | savings  | $10,000.00      | `00000000-0000-4000-8000-000000000102` |
| Bob Smith     | `bob@example.com`   | `1000000003` | checking | $1,200.00       | `00000000-0000-4000-8000-000000000103` |
| Carol Davis   | `carol@example.com` | `1000000004` | checking | $500.00         | `00000000-0000-4000-8000-000000000104` |
|               |                     | `1000000005` | savings  | $0.00           | `00000000-0000-4000-8000-000000000105` |

Transfers to another customer's account are addressed by its account ID; each account page shows
its own ID for sharing.

The seed is deterministic (fixed ids and account numbers) and safe to re-run: rows that already
exist are left untouched, so it never resets balances or deletes history. Passwords are stored
only as bcrypt hashes, and each opening balance is recorded as a deposit in the ledger.

## Configuration

### Backend (`backend/.env`)

| Variable                      | Default       | Description                                                      |
| ----------------------------- | ------------- | ---------------------------------------------------------------- |
| `NODE_ENV`                    | `development` | `development`, `test` or `production`                            |
| `PORT`                        | `4000`        | Port the API listens on                                          |
| `LOG_LEVEL`                   | `info`        | Pino log level                                                   |
| `DATABASE_URL`                | _(required)_  | Development/production PostgreSQL connection string              |
| `TEST_DATABASE_URL`           | _(tests)_     | Test database; required for `npm test`, name must end in `_test` |
| `DB_POOL_MAX`                 | `10`          | Maximum connections in the pool                                  |
| `DB_CONNECTION_TIMEOUT_MS`    | `5000`        | Wait for a free pool connection before failing the request       |
| `DB_IDLE_TIMEOUT_MS`          | `30000`       | Close pool connections unused for this long                      |
| `DB_STATEMENT_TIMEOUT_MS`     | `10000`       | Limit for any statement, and for a transaction left idle         |
| `SHUTDOWN_TIMEOUT_MS`         | `10000`       | Time in-flight requests get on SIGTERM/SIGINT before forced exit |
| `SESSION_SECRET`              | _(required)_  | Key that signs session tokens; at least 32 characters            |
| `SESSION_TTL_MINUTES`         | `60`          | How long a login session lasts                                   |
| `CORS_ALLOWED_ORIGINS`        | _(empty)_     | Extra browser origins allowed to call the API with credentials   |
| `MONEY_RATE_LIMIT_PER_MINUTE` | `30`          | Deposits, withdrawals and transfers per customer per minute      |

The environment is validated at startup; the process exits with a clear message (naming the
variable, never echoing its value) if a variable is missing or malformed. With
`NODE_ENV=production` it also refuses the `.env.example` session secret or an obviously simple
one, and `CORS_ALLOWED_ORIGINS` entries that are not `https`.

`SESSION_SECRET` has no default in code. `.env.example` ships a placeholder so local setup works
without extra steps, and the API refuses to start with that placeholder when `NODE_ENV=production`.
Generate a real secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### Frontend (`frontend/.env.local`)

| Variable           | Default                 | Description                         |
| ------------------ | ----------------------- | ----------------------------------- |
| `API_PROXY_TARGET` | `http://localhost:4000` | Backend that `/api/*` is proxied to |

`API_PROXY_TARGET` is checked when the web app builds or starts: it must be an absolute `http(s)`
URL without credentials.

## Database

### Schema

All money is stored as `BIGINT` minor units (cents). The currency is USD.

| Table            | Purpose                                                                          |
| ---------------- | -------------------------------------------------------------------------------- |
| `customers`      | People who can log in. Email is `CITEXT`, so it is unique case-insensitively.    |
| `accounts`       | One row per bank account, holding the cached current `balance`.                  |
| `transactions`   | One immutable row per business operation (deposit, withdrawal or transfer).      |
| `ledger_entries` | One immutable row per account affected by a transaction, with the balance after. |

Rules enforced by the database itself, independent of application code:

- `accounts.balance >= 0`: an overdraft cannot be committed.
- Amounts are strictly positive; account numbers are exactly 10 digits; types, directions and
  currency are restricted to known values.
- The accounts on a transaction must match its type: a deposit has only a destination, a withdrawal
  only a source, and a transfer has both and they must differ.
- `(initiated_by, idempotency_key)` is unique, so a retried request cannot be applied twice.
- A transaction has at most one ledger entry per account.
- `transactions` and `ledger_entries` are append-only: a trigger rejects `UPDATE` and `DELETE`.
- Foreign keys use `ON DELETE RESTRICT`; nothing with financial history can be deleted.

`accounts.balance` always equals credits minus debits in `ledger_entries` for that account.

### Migrations

Migrations are plain SQL files in `backend/migrations`, applied with `node-pg-migrate`. All pending
migrations run in a single transaction.

| Command (from `backend/`)             | Description                            |
| ------------------------------------- | -------------------------------------- |
| `npm run db:migrate`                  | Apply all pending migrations           |
| `npm run db:migrate:down`             | Revert the most recent migration       |
| `npm run db:migrate:create -- <name>` | Create a new SQL migration file        |
| `npm run db:seed`                     | Insert the demo customers and accounts |

### Transactions

`withTransaction(fn)` in `backend/src/db/transaction.ts` checks one client out of the pool, runs
`BEGIN`, passes the client to `fn`, then runs `COMMIT`. If anything throws, it runs `ROLLBACK` and
rethrows; the client is always released in `finally`. Code inside a transaction must use the
client it is given, never the pool, because the pool would run the statement on a different
connection outside the transaction.

### BIGINT handling

`pg` returns `BIGINT` as a string. The pool registers a parser that converts it to a number and
throws if the value is outside JavaScript's safe integer range, so money is never silently
rounded.

### Development and test databases

Tests run against a separate database and never against development data:

- Under `NODE_ENV=test` the application uses `TEST_DATABASE_URL` and ignores `DATABASE_URL`.
- `TEST_DATABASE_URL` must name a database ending in `_test`, or the process refuses to start.
- The helper that truncates tables first asks the server for `current_database()` and refuses to
  continue unless that name ends in `_test`.

The test run applies pending migrations to the test database automatically.

### Docker Compose

Docker Compose starts PostgreSQL 17 with `bank_dev` and `bank_test`. It is published on host port
**5433** so it does not clash with a PostgreSQL already running on 5432. To use a different port,
set `POSTGRES_PORT` when starting Compose and update the connection strings to match.

## API

Base path: `/api/v1`. Successful responses are wrapped as `{ "data": ... }` and errors as
`{ "error": { "code", "message", "details?", "requestId" } }`. Every response carries an
`X-Request-Id` header and `Cache-Control: no-store`.

| Method | Path                               | Auth                        | Request body                       | Success response                                                                 |
| ------ | ---------------------------------- | --------------------------- | ---------------------------------- | -------------------------------------------------------------------------------- |
| GET    | `/health`                          | none                        | none                               | `200 { "data": { "status": "ok" } }`                                             |
| GET    | `/health/ready`                    | none                        | none                               | `200 { "data": { "status": "ready", "checks": { "database": "ok" } } }` or `503` |
| POST   | `/auth/login`                      | none                        | `{ email, password }`              | `200 { "data": { "customer" } }` + session cookie                                |
| POST   | `/auth/logout`                     | none                        | none                               | `204`, clears the session cookie                                                 |
| GET    | `/auth/me`                         | session                     | none                               | `200 { "data": { "customer" } }`                                                 |
| GET    | `/accounts`                        | session                     | none                               | `200 { "data": { "accounts": [account] } }`                                      |
| GET    | `/accounts/:accountId`             | session                     | none                               | `200 { "data": { "account" } }`                                                  |
| POST   | `/accounts/:accountId/deposits`    | session + `Idempotency-Key` | `{ amount }`                       | `201 { "data": { "transaction", "account" } }`                                   |
| POST   | `/accounts/:accountId/withdrawals` | session + `Idempotency-Key` | `{ amount }`                       | `201 { "data": { "transaction", "account" } }`                                   |
| POST   | `/accounts/:accountId/transfers`   | session + `Idempotency-Key` | `{ destinationAccountId, amount }` | `201 { "data": { "transaction", "account", "destinationAccount" } }`             |
| GET    | `/transactions`                    | session                     | none (query parameters)            | `200 { "data": { "transactions": [item], "nextCursor" } }`                       |

- `customer` is `{ id, email, fullName }`.
- `account` is `{ id, accountNumber, type, currency, balance, createdAt }`. `type` is `checking` or
  `savings`, and `balance` is an integer number of minor units (cents): `250000` means $2,500.00.
- `transaction` is `{ id, type, accountId, amount, currency, balanceAfter, createdAt }`, with
  `amount` and `balanceAfter` in cents. For a transfer it has `sourceAccountId` and
  `destinationAccountId` instead of `accountId`, and `balanceAfter` is the source's balance.

| Error code                      | Status | Meaning                                                                |
| ------------------------------- | ------ | ---------------------------------------------------------------------- |
| `VALIDATION_ERROR`              | 400    | Invalid input; `details` lists `{ path, message }` per field           |
| `INVALID_JSON`                  | 400    | The request body is not valid JSON                                     |
| `BAD_REQUEST`                   | 400    | Malformed request, e.g. an invalid `%`-escape in the URL               |
| `INVALID_CREDENTIALS`           | 401    | Login failed (unknown email or wrong password)                         |
| `UNAUTHENTICATED`               | 401    | Missing, invalid or expired session                                    |
| `ORIGIN_NOT_ALLOWED`            | 403    | Cross-origin write or preflight from an untrusted origin               |
| `ACCOUNT_NOT_FOUND`             | 404    | No such account, or it belongs to another customer                     |
| `NOT_FOUND`                     | 404    | Unknown route                                                          |
| `METHOD_NOT_ALLOWED`            | 405    | Wrong HTTP method for the endpoint; see the `Allow` header             |
| `IDEMPOTENCY_CONFLICT`          | 409    | `Idempotency-Key` already used for a different request                 |
| `PAYLOAD_TOO_LARGE`             | 413    | Request body over 10kb                                                 |
| `UNSUPPORTED_MEDIA_TYPE`        | 415    | Body that is not UTF-8 JSON                                            |
| `INSUFFICIENT_FUNDS`            | 422    | Withdrawal or transfer larger than the balance                         |
| `SAME_ACCOUNT_TRANSFER`         | 422    | Transfer source and destination are the same account                   |
| `DESTINATION_ACCOUNT_NOT_FOUND` | 422    | Transfer destination does not exist                                    |
| `BALANCE_LIMIT_EXCEEDED`        | 422    | Deposit would exceed the largest exactly representable balance         |
| `RATE_LIMITED`                  | 429    | Too many failed logins or money movements; `details.retryAfterSeconds` |
| `INTERNAL_ERROR`                | 500    | Unexpected error; details are logged, not returned                     |
| `SERVICE_UNAVAILABLE`           | 503    | Readiness check failed or shutdown in progress; see `details`          |

## Authentication

- **Login** checks the password with bcrypt and answers an unknown email and a wrong password with
  the same `401 INVALID_CREDENTIALS`. An unknown email is still checked against a decoy hash, so
  response time does not reveal which emails are registered.
- **Session** is a JWT (HS256) holding only the customer id and expiry, stored in a cookie that is
  `HttpOnly` (unreadable from JavaScript), `SameSite=Lax` (not sent on cross-site POSTs) and
  `Secure` in production. It expires after `SESSION_TTL_MINUTES`.
- **`requireAuth`** verifies the cookie, checks the customer still exists, and exposes the caller as
  `req.auth` (`AuthContext`), which services use for ownership checks. Anything else gets
  `401 UNAUTHENTICATED`.
- **Logout** clears the cookie. Sessions are stateless, so a copied token stays valid until it
  expires; see "Production improvements" for server-side revocation.
- **Rate limiting** allows 5 failed logins per account (email) per 15 minutes. It is keyed on the
  email rather than the client IP because every request arrives through the Next.js proxy and so
  shares one source address; an IP-keyed limit would treat all customers as one client. The
  trade-off is that someone can temporarily lock a known email out by failing on purpose, and
  guessing one password across many emails is not limited here.
- **Logs** contain the method, path, status, duration, request id and customer id of each request.
  Headers, cookies, query strings and bodies are never logged.
- **`X-Request-Id`** from the client is reused only if it is 1–64 characters of letters, digits,
  `.`, `_` or `-`; otherwise a new id is generated.

### Production improvements

- Server-side session store (or token denylist) so logout and password changes revoke sessions.
- Rate limiting at the edge by client IP, with a shared store such as Redis across instances.
- MFA, account lockout notifications and refresh-token rotation.

## Accounts

- **Authentication.** Both account endpoints require a session and return `401 UNAUTHENTICATED`
  without one.
- **Ownership.** The customer is always taken from the session, never from the request. A
  `customerId` sent in the query string or body is ignored.
- **Enforced in the query.** An account is loaded with `WHERE id = $1 AND customer_id = $2`, so
  there is no code path that fetches an account first and checks its owner afterwards.
- **No enumeration.** An account that belongs to someone else and an account that does not exist
  both return the same `404 ACCOUNT_NOT_FOUND`. A malformed id returns `400 VALIDATION_ERROR`.
- **Listing** returns only the caller's accounts, ordered by account number.
- **In the UI** account numbers are masked to the last four digits. The detail page can reveal the
  customer's own full number on request.

## Deposits and withdrawals

```http
POST /api/v1/accounts/00000000-0000-4000-8000-000000000101/deposits
Content-Type: application/json
Idempotency-Key: 6f1c2a4e-8d0b-4f7a-9c3e-2b5d7a9e1f40

{ "amount": 1050 }
```

- **Amounts** are a JSON integer of cents: `1050` is $10.50. Zero, negative, fractional, string
  and unsafe values are rejected with `400`, as is anything above `100000000` ($1,000,000.00) or
  any field other than `amount`. The web app converts what the user types ("10.50") to cents by
  parsing the text, never with floating-point arithmetic.
- **Authentication and ownership** work as for accounts: a session is required, the customer comes
  from the session, and someone else's account returns `404 ACCOUNT_NOT_FOUND`.
- **Insufficient funds.** A withdrawal larger than the balance returns `422 INSUFFICIENT_FUNDS`
  and changes nothing: no balance update, no transaction, no ledger entry. Overdrafts are not
  supported, and `CHECK (balance >= 0)` in the database backs this up.
- **Atomicity.** Each operation is one database transaction: lock the account row, check, update
  the balance, insert the `transactions` row, insert the `ledger_entries` row, commit. Any error
  rolls all of it back. Deposits are a credit entry on the destination account and withdrawals a
  debit entry on the source account, as in the schema; `balance_after` records the running balance.
- **Concurrency.** The account row is locked with `SELECT ... FOR UPDATE` before the balance is
  read, so operations on the same account run one at a time and each sees the balance the previous
  one committed. Two simultaneous $80 withdrawals from $100 result in one success and one
  `INSUFFICIENT_FUNDS`. Different accounts never wait for each other.
- **Idempotency.** The `Idempotency-Key` header is required (1–255 visible ASCII characters; the
  web app sends a UUID per action). The key is stored on the transaction, where
  `UNIQUE (initiated_by, idempotency_key)` already exists, so it is backed by PostgreSQL and
  checked inside the same transaction as the money movement.
  - The same key with the same operation, account and amount returns the original result
    (`201`, header `Idempotent-Replayed: true`) without moving money again, including when the
    duplicates arrive at the same time.
  - The same key with a different amount, account or operation returns `409 IDEMPOTENCY_CONFLICT`.
    A key identifies one request, so a deposit's key can never trigger a withdrawal.
  - Keys are scoped per customer. A request that fails (for example `INSUFFICIENT_FUNDS`) stores
    nothing, so its key can be used again.
  - If the web app cannot confirm the outcome (network error or `5xx`), it keeps the key, and
    submitting the same operation and amount again reuses it.

Limitations: there are no descriptions, fees, holds or daily limits; and only successful requests
are remembered for idempotency, so a retry of a refused request is evaluated afresh.

## Transfers

```http
POST /api/v1/accounts/00000000-0000-4000-8000-000000000101/transfers
Content-Type: application/json
Idempotency-Key: 0b8f6c3e-2a51-4c1e-9d7a-5f3e8b2c4a10

{ "destinationAccountId": "00000000-0000-4000-8000-000000000103", "amount": 2500 }
```

The account in the path is the source and must belong to the caller. The destination can be any
account, including another customer's.

- **Validation.** `amount` follows the same rules as deposits (integer cents, 1 to `100000000`).
  `destinationAccountId` must be a UUID, and no other fields are accepted. Account ids are
  normalised to lower case, so two spellings of one id are treated as the same account.
- **Errors.** Someone else's or an unknown source returns `404 ACCOUNT_NOT_FOUND`, as elsewhere.
  An unknown destination returns `422 DESTINATION_ACCOUNT_NOT_FOUND`, a transfer to the source
  itself `422 SAME_ACCOUNT_TRANSFER`, and too little money `422 INSUFFICIENT_FUNDS`. None of them
  change anything.
- **Privacy.** The response contains the transfer and the source account. `destinationAccount` is
  included only when the caller owns it, and is `null` for another customer's account, whose
  balance, account number and owner are never returned.
- **Atomicity.** One database transaction locks both accounts, checks ownership, existence and
  funds, updates both balances, and inserts one `transfer` transaction with two ledger entries: a
  debit on the source and a credit on the destination, each with its `balance_after`. Any failure
  rolls back all of it, including the idempotency key.
- **Deadlock prevention.** Both rows are locked with `SELECT ... FOR UPDATE` in ascending account-id
  order, not source-then-destination. If transfers locked the source first, A→B and B→A running
  together could each hold one row while waiting for the other. With a single global order every
  transaction waits in the same direction, so no cycle can form. The tests run 60 interleaved
  A→B/B→A transfers and an A→B→C→A cycle; switching the code to source-first ordering makes the
  A→B/B→A test fail.
- **Concurrency.** Transfers sharing an account run one at a time; unrelated accounts never wait
  for each other. A source can never be overdrawn, however many transfers compete for it.
- **Idempotency.** The same mechanism as deposits and withdrawals: one key per customer, stored on
  the transaction. The same key with the same source, destination and amount replays the original
  transfer; any difference (including a key first used for a deposit or withdrawal) returns
  `409 IDEMPOTENCY_CONFLICT`. Simultaneous duplicates produce exactly one transfer.

Assumptions and limitations:

- Recipients are addressed by account ID, as the API specifies. A production system would address
  them by account number and show the recipient's name for confirmation before sending.
- Because the destination may belong to anyone, the API necessarily reveals whether a given account
  ID exists. Account IDs are random UUIDs and cannot practically be guessed.
- Single currency (USD), enforced by the schema. There are no transfer limits beyond the
  per-operation maximum, no scheduled or pending transfers, and no reversals.

## Transaction history

```http
GET /api/v1/transactions?limit=20&type=transfer&accountId=<uuid>&from=2026-10-01&to=2026-11-01
```

Each history item describes how one transaction affected one of the caller's accounts. It is one
row of `ledger_entries` joined to its `transactions` row. Nothing new is stored.

```json
{
  "transactionId": "…",
  "type": "transfer",
  "direction": "debit",
  "amount": 1000,
  "currency": "USD",
  "accountId": "<the caller's account>",
  "balanceAfter": 6500,
  "counterparty": { "accountId": "<destination>", "ownedByYou": false },
  "createdAt": "2026-10-01T09:30:00.000Z"
}
```

- **`direction`** is `credit` (money in) or `debit` (money out) for `accountId`. `amount` is always
  positive integer cents, and `balanceAfter` is that account's balance right after the transaction.
- **Transfers between the caller's own accounts** appear twice, once on each account, as on a bank
  statement. The two items share a `transactionId`; `transactionId` + `accountId` is unique.
- **`counterparty`** is set for transfers only. Its `accountId` is shown when the caller owns that
  account or sent the transfer to it (so already knows it). It is `null` for money received from
  another customer. No other customer's name, account number, balance or owner is ever returned.

**Query parameters.** All are optional, and any other parameter (`customerId`, sort fields, …) is
rejected with `400`.

| Parameter   | Meaning                                                                   |
| ----------- | ------------------------------------------------------------------------- |
| `limit`     | Page size, 1–100, default 20                                              |
| `cursor`    | `nextCursor` from the previous page                                       |
| `type`      | `deposit`, `withdrawal` or `transfer`                                     |
| `accountId` | One of the caller's accounts; anyone else's simply matches nothing        |
| `from`      | Inclusive start: ISO 8601 date-time with offset, or a date (midnight UTC) |
| `to`        | Exclusive end, same format; must be later than `from`                     |

**Ownership.** The query joins each ledger entry to its account and requires
`accounts.customer_id` to be the caller (taken from the session). Filters can only narrow that
set, so no filter, cursor or id can reach another customer's entries.

**Pagination** is keyset (cursor) based on the ledger entry id, newest first. A page is
`ORDER BY id DESC LIMIT limit + 1`; the extra row only tells whether `nextCursor` should be set, so
no `COUNT` and no full scan are needed. Unlike page numbers, a cursor never skips or repeats
entries when new transactions arrive while paging. The trade-off is no "jump to page N" and no
total count. The web app pages with "Load more".

**Indexes.** No migration was needed. The query uses `accounts_customer_id_idx` to find the
caller's accounts, then `ledger_entries (account_id, id DESC)` (created with the schema for this
purpose) for each account, with the cursor applied inside the index scan, and primary keys for the
rest; `EXPLAIN` confirms it. For a customer with very many entries across several accounts, the
final sort covers that customer's own entries below the cursor. At much larger volumes, a
customer column on `ledger_entries` with its own index would remove that sort.

**Detail endpoint.** There is no `GET /transactions/:id`. Each list item already carries
everything the app shows, and the deposit, withdrawal and transfer responses return the full
transaction when it is created, so a second endpoint would only add another surface that needs the
same ownership checks.

## Security

A summary of the controls in place. Each one is covered by tests in
`backend/tests/integration/security` and the module tests.

**Authentication and session.** Passwords are bcrypt-hashed (cost 12). A login failure gives the
same answer and timing for an unknown email and a wrong password. The session is an HS256 JWT,
pinned to that algorithm, with a required issuer, subject and expiry, signed with
`SESSION_SECRET` (at least 32 characters, no default, placeholder refused in production). The
customer it names must still exist on every request. The cookie is `HttpOnly`, `SameSite=Lax`,
`Path=/`, and `Secure` in production; the web app never sees or stores the token.

**Authorization.** The customer always comes from the verified session, never from a URL, query
or body. Account ownership is a condition in every SQL query, so another customer's account looks
exactly like a non-existent one (`404`), and history is restricted to the caller's accounts in
SQL. Request bodies are strict (unknown fields such as `customerId` are rejected), ids must be
UUIDs, amounts are bounded integers, and history accepts only its documented query parameters,
each at most once.

**Money safety.** Every money movement is one database transaction with row locks taken in a fixed
order, database constraints that forbid negative balances, an append-only ledger, and
idempotency keys backed by a unique constraint (see the sections above).

**Cross-site requests and CORS.** The web app reaches the API through its own `/api` proxy, so no
CORS is needed and none is granted by default. `CORS_ALLOWED_ORIGINS` can list exact extra
origins: they get credentialed CORS with their origin echoed back (never `*`; wildcards are
refused at startup). Preflights from other origins get `403`. Any state-changing request whose
`Origin` is neither trusted nor the request's own site (through the proxy's `X-Forwarded-Host`)
is refused with `403 ORIGIN_NOT_ALLOWED` before it reaches a handler. This is CSRF protection on
top of `SameSite=Lax`, which still treats other ports and subdomains as the same site. Bodies must
be JSON (`415` otherwise), so a plain HTML form cannot submit to the API.

**Rate limiting.** 5 failed logins per email per 15 minutes. `MONEY_RATE_LIMIT_PER_MINUTE`
(default 30) money movements per customer per minute, shared by deposits, withdrawals and
transfers, counting rejected attempts too. That is far above what a person does in the app, but
stops a script from draining an account in many small transfers. Limits are keyed on the email or
customer, not the IP, because all browser traffic arrives from the proxy's address. Reads are not
limited.

**Request limits.** JSON bodies up to 10 kB (`413` beyond). Unsupported methods get
`405 METHOD_NOT_ALLOWED` with an `Allow` header. The server limits headers to 15 s and whole
requests to 30 s, and the database limits statements and idle transactions to 10 s.

**Headers.** The API sends `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`,
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, a
restrictive `Permissions-Policy`, `Cache-Control: no-store`, and HSTS in production only. The web
app's pages send a CSP that forbids framing (clickjacking), plugins and other script origins, plus
the same frame, sniffing, referrer and permissions headers, HSTS in production, and no
`X-Powered-By`. Their CSP allows inline scripts and styles because Next.js emits them; removing
that would require nonce-based rendering of every page.

**Errors.** Clients receive only `{ code, message, details?, requestId }`. Unexpected failures
become a generic `500 INTERNAL_ERROR` in every environment, with no stack trace, SQL, database
detail or file path. Malformed input from parsers or the router is a `4xx`, never a `500`, and
unknown routes are not echoed back.

**Logging.** One line per request: method, path without query string, status, duration, request
id and customer id. Never headers, cookies, tokens, bodies, amounts, balances, account numbers or
idempotency keys. Error logs drop the row data PostgreSQL attaches to errors (`detail`, `where`,
`hint`) and mask credentials in any URL. A client-supplied `X-Request-Id` is reused only if it is
a short plain token, so it cannot inject log lines or headers. See "Production operations" below.

**Known limitations.**

- Logout clears the cookie, but sessions are stateless JWTs: a copied token remains valid until it
  expires (60 minutes by default). Revocation would need a server-side session store.
- Rate-limit counters are in memory, per instance, and reset on restart.
- Login limiting is per email, so one password tried across many emails is not limited, and
  someone can briefly lock a known email out.
- The web app's CSP allows inline scripts.

**Production recommendations.** Serve everything over HTTPS (HSTS and `Secure` cookies are turned
on by `NODE_ENV=production`); set a unique random `SESSION_SECRET` from a secrets manager; keep
the API reachable only through the web app's proxy or a gateway; add per-IP rate limiting at the
edge with a shared store (e.g. Redis); run the database with least-privilege credentials and TLS;
and forward logs to a central store with retention limits.

## Production operations

**Health checks.** Neither needs a session; both return `Cache-Control: no-store`.

| Endpoint                   | Meaning                                                                                                                                            | Use for                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `GET /api/v1/health`       | The process is up. Touches nothing else, so a database outage never makes it look dead.                                                            | Liveness (restart if it fails) |
| `GET /api/v1/health/ready` | PostgreSQL answers `SELECT 1` within 2 s and shutdown has not begun. Otherwise `503 SERVICE_UNAVAILABLE` with `details` saying which check failed. | Readiness (route traffic)      |

The `503` never includes the database host, user, connection string or error. Note that a pool
saturated for longer than the readiness timeout also reports "not ready".

**Request ids.** Every request gets an id: the caller's `X-Request-Id` if it is 1–64 characters
of letters, digits, `.`, `_` or `-`, otherwise a random UUID. It is returned in the
`X-Request-Id` header, included in every error body as `requestId`, and present on every log line
for that request (`req.id`). To investigate a report, search the logs for the id the user saw.

**Logs** are JSON, one object per line on stdout, with `time` (ISO 8601), `level`, `service`
(`banking-api`), `env`, `pid` and `hostname`. Each completed request writes one access line
(`msg` is `request completed` or `request failed`) with `req.{id, method, path}`,
`res.statusCode`, `durationMs`, `customerId` once authenticated, and `errorCode` for failures.
Levels: `error` for 5xx, `info` for everything else, and `debug` for successful health checks so
probes don't flood the logs. Unexpected errors also write an `Unhandled error` line with the
sanitised error. What is never logged is listed under Security.

**Graceful shutdown.** On `SIGTERM` or `SIGINT` the API:

1. marks itself not ready (`/health/ready` turns `503`), so a load balancer stops sending traffic;
2. stops accepting connections and closes idle keep-alive ones;
3. lets in-flight requests finish;
4. closes the database pool;
5. exits with `0`, or `1` if anything failed.

If requests are still running after `SHUTDOWN_TIMEOUT_MS` (default 10 s), it closes the remaining
connections and exits with `1`, so shutdown can never hang. Repeated signals are ignored. An
uncaught exception or unhandled promise rejection is logged and exits with `1`, so a supervisor
restarts the process.

**Database.** One pool per process, `DB_POOL_MAX` connections (default 10). When all are busy a
request waits up to `DB_CONNECTION_TIMEOUT_MS` for one and then fails with a `500`, rather than
queueing indefinitely. Every statement, and every transaction left idle, is cut off after
`DB_STATEMENT_TIMEOUT_MS`, so row locks are never held indefinitely. Errors on idle connections
are logged, not fatal. Size the pool so that `DB_POOL_MAX` × instances stays below the database's
connection limit.

**Build, test and run.**

```bash
npm run install:all
npm run build
npm test
```

```bash
cd backend && node dist/db/scripts/migrate.js up && npm start
```

```bash
cd frontend && npm start
```

`npm test` needs the test database from `TEST_DATABASE_URL`. The backend serves on `PORT`; the web
app serves on 3000 and proxies `/api` to `API_PROXY_TARGET`. Migrations run from the compiled
output (`dist/`), so they also work on a production install without dev dependencies; the
`npm run db:migrate` and `db:seed` scripts use `tsx` and are meant for development.

**Operational limitations.**

- Rate-limit counters live in memory: they are per instance and reset on restart.
- Readiness checks only the database; there are no metrics or tracing endpoints. Request ids are
  the correlation mechanism.
- Logs go to stdout; shipping, retention and alerting are left to the platform.
- Graceful shutdown relies on POSIX signals; on Windows only `SIGINT` (Ctrl+C) is delivered.

## Scripts

Run from `banking-app/`; each delegates to the backend and frontend packages.

| Command                | Description                                          |
| ---------------------- | ---------------------------------------------------- |
| `npm run db:migrate`   | Apply pending database migrations                    |
| `npm run db:seed`      | Insert the demo data                                 |
| `npm run typecheck`    | Type-check both applications                         |
| `npm run lint`         | Lint both applications                               |
| `npm run build`        | Build both applications                              |
| `npm test`             | Run the backend test suite (needs the test database) |
| `npm run format`       | Format the repository with Prettier                  |
| `npm run format:check` | Check formatting without writing                     |

To run one area of the test suite, for example the transfer tests, from `backend/`:

```bash
npx vitest run tests/integration/transfers
npx vitest run tests/integration/history
npx vitest run tests/integration/security
npx vitest run tests/integration/observability tests/unit/shutdown.test.ts
```

## Design notes

- **Single origin.** The browser only talks to Next.js, which proxies `/api/*` to Express. This
  avoids CORS configuration and keeps session cookies first-party.
- **App factory.** `createApp()` builds the Express app without listening on a port, so tests
  exercise the real middleware stack through Supertest.
- **Fail-fast configuration.** Environment variables are parsed once with Zod and imported as a
  typed object everywhere else. The API also checks the database connection before listening.
- **Constraints in the database.** Financial invariants are enforced by PostgreSQL constraints and
  triggers as well as by application code, so a bug in one layer cannot corrupt the ledger.
- **Tests use a real database.** Locking, rollback and constraint behaviour cannot be verified with
  mocks, so integration tests run against PostgreSQL.
