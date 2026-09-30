# Banking App

A simple banking web application: view accounts, deposit, withdraw, transfer between customers
and browse transaction history.

> **Status:** project and database foundation. The tooling, both applications, the health endpoint,
> the database schema, migrations and seed data are in place; authentication and the banking
> features are added in later milestones.

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
│   │   ├── middleware/       Request logging, 404 and error handlers
│   │   ├── modules/          Feature modules (currently: health)
│   │   ├── routes/           Versioned API routers
│   │   ├── app.ts            Express app factory (no port binding; used by tests)
│   │   └── server.ts         Process entry point
│   └── tests/
│       ├── integration/      Tests that run against the test database
│       ├── unit/
│       ├── helpers/          Fixtures and the guarded database reset
│       └── setup/            Test-run setup (migrations, pool teardown)
└── frontend/                 Next.js application
    └── src/
        ├── app/              Routes and layouts
        └── components/
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

The home page shows an "API status" indicator, which calls the health endpoint through the
frontend proxy and confirms the two applications are wired together.

### Demo data

`npm run db:seed` creates three customers, all with the password `Demo-Password-123`:

| Customer      | Email               | Accounts                                                         |
| ------------- | ------------------- | ---------------------------------------------------------------- |
| Alice Johnson | `alice@example.com` | `1000000001` checking $2,500.00, `1000000002` savings $10,000.00 |
| Bob Smith     | `bob@example.com`   | `1000000003` checking $1,200.00                                  |
| Carol Davis   | `carol@example.com` | `1000000004` checking $500.00, `1000000005` savings $0.00        |

The seed is deterministic (fixed ids and account numbers) and safe to re-run: rows that already
exist are left untouched, so it never resets balances or deletes history. Passwords are stored
only as bcrypt hashes, and each opening balance is recorded as a deposit in the ledger.

## Configuration

### Backend (`backend/.env`)

| Variable            | Default       | Description                                                      |
| ------------------- | ------------- | ---------------------------------------------------------------- |
| `NODE_ENV`          | `development` | `development`, `test` or `production`                            |
| `PORT`              | `4000`        | Port the API listens on                                          |
| `LOG_LEVEL`         | `info`        | Pino log level                                                   |
| `DATABASE_URL`      | _(required)_  | Development/production PostgreSQL connection string              |
| `TEST_DATABASE_URL` | _(tests)_     | Test database; required for `npm test`, name must end in `_test` |
| `DB_POOL_MAX`       | `10`          | Maximum connections in the pool                                  |

The environment is validated at startup; the process exits with a clear message if a variable is
missing or malformed.

### Frontend (`frontend/.env.local`)

| Variable           | Default                 | Description                         |
| ------------------ | ----------------------- | ----------------------------------- |
| `API_PROXY_TARGET` | `http://localhost:4000` | Backend that `/api/*` is proxied to |

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
`{ "error": { "code", "message", "requestId" } }`. Every response carries an `X-Request-Id` header.

| Method | Path      | Description    | Response                             |
| ------ | --------- | -------------- | ------------------------------------ |
| GET    | `/health` | Liveness check | `200 { "data": { "status": "ok" } }` |

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
