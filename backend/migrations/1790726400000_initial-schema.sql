-- Up Migration

-- Case-insensitive text, used for customer email addresses.
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- Shared trigger functions
-- ---------------------------------------------------------------------------

CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Financial records are append-only: corrections are made with new
-- transactions, never by editing or deleting history.
CREATE FUNCTION reject_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- customers: people who can log in and own accounts
-- ---------------------------------------------------------------------------

CREATE TABLE customers (
  id            UUID        NOT NULL DEFAULT gen_random_uuid(),
  email         CITEXT      NOT NULL,
  full_name     TEXT        NOT NULL,
  password_hash TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT customers_pkey PRIMARY KEY (id),
  CONSTRAINT customers_email_key UNIQUE (email),
  CONSTRAINT customers_email_check CHECK (email LIKE '_%@_%' AND char_length(email) <= 254),
  CONSTRAINT customers_full_name_check CHECK (btrim(full_name) <> ''),
  CONSTRAINT customers_password_hash_check CHECK (password_hash <> '')
);

-- ---------------------------------------------------------------------------
-- accounts: one row per bank account, holding the cached current balance
-- ---------------------------------------------------------------------------

CREATE TABLE accounts (
  id             UUID        NOT NULL DEFAULT gen_random_uuid(),
  customer_id    UUID        NOT NULL,
  account_number TEXT        NOT NULL,
  type           TEXT        NOT NULL,
  currency       CHAR(3)     NOT NULL DEFAULT 'USD',
  -- Minor units (cents). Always equals credits minus debits in ledger_entries.
  balance        BIGINT      NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT accounts_pkey PRIMARY KEY (id),
  CONSTRAINT accounts_customer_id_fkey FOREIGN KEY (customer_id)
    REFERENCES customers (id) ON DELETE RESTRICT,
  CONSTRAINT accounts_account_number_key UNIQUE (account_number),
  CONSTRAINT accounts_account_number_check CHECK (account_number ~ '^[0-9]{10}$'),
  CONSTRAINT accounts_type_check CHECK (type IN ('checking', 'savings')),
  CONSTRAINT accounts_currency_check CHECK (currency = 'USD'),
  -- Last line of defence against overdrafts, whatever the application does.
  CONSTRAINT accounts_balance_check CHECK (balance >= 0)
);

CREATE INDEX accounts_customer_id_idx ON accounts (customer_id);

CREATE TRIGGER accounts_set_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- transactions: one immutable row per business operation
-- ---------------------------------------------------------------------------

CREATE TABLE transactions (
  id                     UUID        NOT NULL DEFAULT gen_random_uuid(),
  type                   TEXT        NOT NULL,
  amount                 BIGINT      NOT NULL,
  currency               CHAR(3)     NOT NULL DEFAULT 'USD',
  source_account_id      UUID,
  destination_account_id UUID,
  description            TEXT,
  initiated_by           UUID        NOT NULL,
  idempotency_key        TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT transactions_pkey PRIMARY KEY (id),
  CONSTRAINT transactions_source_account_id_fkey FOREIGN KEY (source_account_id)
    REFERENCES accounts (id) ON DELETE RESTRICT,
  CONSTRAINT transactions_destination_account_id_fkey FOREIGN KEY (destination_account_id)
    REFERENCES accounts (id) ON DELETE RESTRICT,
  CONSTRAINT transactions_initiated_by_fkey FOREIGN KEY (initiated_by)
    REFERENCES customers (id) ON DELETE RESTRICT,
  CONSTRAINT transactions_type_check CHECK (type IN ('deposit', 'withdrawal', 'transfer')),
  CONSTRAINT transactions_amount_check CHECK (amount > 0),
  CONSTRAINT transactions_currency_check CHECK (currency = 'USD'),
  CONSTRAINT transactions_description_check CHECK (char_length(description) <= 140),
  CONSTRAINT transactions_idempotency_key_check
    CHECK (char_length(idempotency_key) BETWEEN 1 AND 255),
  -- Which accounts are involved is fixed by the transaction type.
  CONSTRAINT transactions_accounts_check CHECK (
    (type = 'deposit'
      AND source_account_id IS NULL
      AND destination_account_id IS NOT NULL)
    OR (type = 'withdrawal'
      AND source_account_id IS NOT NULL
      AND destination_account_id IS NULL)
    OR (type = 'transfer'
      AND source_account_id IS NOT NULL
      AND destination_account_id IS NOT NULL
      AND source_account_id <> destination_account_id)
  ),
  -- A customer can use an idempotency key once. NULL keys never conflict.
  CONSTRAINT transactions_initiated_by_idempotency_key_key UNIQUE (initiated_by, idempotency_key)
);

CREATE INDEX transactions_source_account_id_idx ON transactions (source_account_id);
CREATE INDEX transactions_destination_account_id_idx ON transactions (destination_account_id);

CREATE TRIGGER transactions_reject_modification
  BEFORE UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

-- ---------------------------------------------------------------------------
-- ledger_entries: one immutable row per account affected by a transaction
-- ---------------------------------------------------------------------------

CREATE TABLE ledger_entries (
  -- Monotonic id: gives a stable order and a simple pagination cursor.
  id             BIGINT      GENERATED ALWAYS AS IDENTITY,
  transaction_id UUID        NOT NULL,
  account_id     UUID        NOT NULL,
  direction      TEXT        NOT NULL,
  amount         BIGINT      NOT NULL,
  -- Account balance immediately after this entry was applied.
  balance_after  BIGINT      NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ledger_entries_pkey PRIMARY KEY (id),
  CONSTRAINT ledger_entries_transaction_id_fkey FOREIGN KEY (transaction_id)
    REFERENCES transactions (id) ON DELETE RESTRICT,
  CONSTRAINT ledger_entries_account_id_fkey FOREIGN KEY (account_id)
    REFERENCES accounts (id) ON DELETE RESTRICT,
  CONSTRAINT ledger_entries_direction_check CHECK (direction IN ('credit', 'debit')),
  CONSTRAINT ledger_entries_amount_check CHECK (amount > 0),
  CONSTRAINT ledger_entries_balance_after_check CHECK (balance_after >= 0),
  -- A transaction touches a given account at most once.
  CONSTRAINT ledger_entries_transaction_id_account_id_key UNIQUE (transaction_id, account_id)
);

-- Serves account history: newest entries first, keyset pagination on id.
CREATE INDEX ledger_entries_account_id_id_idx ON ledger_entries (account_id, id DESC);

CREATE TRIGGER ledger_entries_reject_modification
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

-- Down Migration

DROP TABLE ledger_entries;
DROP TABLE transactions;
DROP TABLE accounts;
DROP TABLE customers;
DROP FUNCTION reject_modification();
DROP FUNCTION set_updated_at();
DROP EXTENSION IF EXISTS citext;
