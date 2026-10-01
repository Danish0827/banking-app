"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { listAccounts, type Account } from "@/lib/accounts";
import { ApiError, type FieldError } from "@/lib/api";
import { formatAccountType, formatMoney, maskAccountNumber } from "@/lib/format";
import { parseAmountToCents } from "@/lib/money";
import { transferMoney } from "@/lib/transactions";
import { useApiData } from "@/lib/useApiData";
import { isOutcomeUnknown, useIdempotencyKey } from "@/lib/useIdempotencyKey";

const OTHER_ACCOUNT = "other";
const ACCOUNT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface FieldErrors {
  destination?: string;
  amount?: string;
}

type Feedback = { kind: "success" | "error"; message: string } | null;

function describeAccount(account: Account): string {
  return `${formatAccountType(account.type)} ${maskAccountNumber(account.accountNumber)}`;
}

/** Maps an API failure to field errors and/or one form-level message. */
function describeError(err: unknown, source: Account): { fields: FieldErrors; form?: string } {
  if (!(err instanceof ApiError)) {
    return { fields: {}, form: "Something went wrong. Please try again." };
  }
  switch (err.code) {
    case "INSUFFICIENT_FUNDS":
      return {
        fields: {},
        form: `Insufficient funds. The available balance is ${formatMoney(source.balance, source.currency)}.`,
      };
    case "DESTINATION_ACCOUNT_NOT_FOUND":
      return { fields: { destination: "We couldn't find an account with that ID." } };
    case "SAME_ACCOUNT_TRANSFER":
      return { fields: { destination: "Choose a different account to send to." } };
    case "BALANCE_LIMIT_EXCEEDED":
      return { fields: {}, form: "The destination account can't receive this amount." };
    case "ACCOUNT_NOT_FOUND":
      return { fields: {}, form: "This account is no longer available." };
    case "IDEMPOTENCY_CONFLICT":
      return { fields: {}, form: "This request clashed with an earlier one. Please try again." };
    case "VALIDATION_ERROR": {
      const fields: FieldErrors = {};
      for (const { path } of (err.details as FieldError[] | undefined) ?? []) {
        if (path === "destinationAccountId") fields.destination = "Enter a valid account ID.";
        if (path === "amount") fields.amount = "Enter a valid amount.";
      }
      return { fields, form: Object.keys(fields).length ? undefined : "Please check the details." };
    }
    default:
      return {
        fields: {},
        form: isOutcomeUnknown(err)
          ? "We couldn't confirm the transfer. Submitting the same transfer again is safe: it will not be applied twice."
          : "Something went wrong. Please try again.",
      };
  }
}

const INPUT_CLASSES =
  "block w-full rounded-md border px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-slate-900/20";

/**
 * Transfers money from this account to another of the customer's accounts,
 * or to any other account by its ID. Ownership, existence and funds are all
 * checked by the API; this form only helps the customer get the input right.
 *
 * Idempotency works as in the deposit form: a retry of the same transfer
 * after an unknown outcome reuses its key, so it is applied at most once.
 */
export function TransferForm({
  account,
  onCompleted,
}: {
  account: Account;
  onCompleted: () => void;
}) {
  const router = useRouter();
  const ownAccounts = useApiData(listAccounts);
  const idempotency = useIdempotencyKey();

  const [destinationChoice, setDestinationChoice] = useState("");
  const [otherAccountId, setOtherAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [submitting, setSubmitting] = useState(false);

  const otherOwnAccounts =
    ownAccounts.status === "success" ? ownAccounts.data.filter((a) => a.id !== account.id) : [];

  /** The destination id and a description for messages, or a field error. */
  function resolveDestination(): { id: string; label: string } | { error: string } {
    if (destinationChoice === "") {
      return { error: "Choose where to send the money." };
    }
    if (destinationChoice !== OTHER_ACCOUNT) {
      const own = otherOwnAccounts.find((a) => a.id === destinationChoice);
      return { id: destinationChoice, label: own ? describeAccount(own) : "your account" };
    }

    const id = otherAccountId.trim().toLowerCase();
    if (!ACCOUNT_ID_PATTERN.test(id)) {
      return {
        error: "Enter a valid account ID, for example 00000000-0000-4000-8000-000000000103.",
      };
    }
    if (id === account.id) {
      return { error: "Choose a different account to send to." };
    }
    return { id, label: "the destination account" };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setFeedback(null);

    const destination = resolveDestination();
    const parsed = parseAmountToCents(amount);
    const fieldErrors: FieldErrors = {
      destination: "error" in destination ? destination.error : undefined,
      amount: parsed.ok ? undefined : parsed.error,
    };
    setErrors(fieldErrors);
    if ("error" in destination || !parsed.ok) return;

    const idempotencyKey = idempotency.keyFor(`transfer:${destination.id}:${parsed.cents}`);

    setSubmitting(true);
    try {
      await transferMoney(account.id, destination.id, parsed.cents, idempotencyKey);
      idempotency.settle();
      setAmount("");
      setOtherAccountId("");
      setDestinationChoice("");
      setFeedback({
        kind: "success",
        message: `Transferred ${formatMoney(parsed.cents, account.currency)} to ${destination.label}.`,
      });
      onCompleted();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      idempotency.settle(err);
      const described = describeError(err, account);
      setErrors(described.fields);
      if (described.form) setFeedback({ kind: "error", message: described.form });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold tracking-tight">Transfer money</h2>
      <p className="mt-1 text-sm text-slate-600">
        Send money from this account to another of your accounts, or to another customer&apos;s
        account using its account ID.
      </p>

      <form onSubmit={handleSubmit} noValidate className="mt-4 space-y-4">
        <div>
          <label htmlFor="destination" className="block text-sm font-medium text-slate-700">
            Destination account
          </label>
          <select
            id="destination"
            value={destinationChoice}
            onChange={(event) => {
              setDestinationChoice(event.target.value);
              setErrors((current) => ({ ...current, destination: undefined }));
            }}
            aria-invalid={errors.destination ? true : undefined}
            aria-describedby={errors.destination ? "destination-error" : undefined}
            className={`mt-1 ${INPUT_CLASSES} ${errors.destination ? "border-red-400" : "border-slate-300"}`}
          >
            <option value="">Choose an account…</option>
            {otherOwnAccounts.map((own) => (
              <option key={own.id} value={own.id}>
                {describeAccount(own)} (your account)
              </option>
            ))}
            <option value={OTHER_ACCOUNT}>Another customer&apos;s account (enter its ID)</option>
          </select>

          {destinationChoice === OTHER_ACCOUNT && (
            <div className="mt-2">
              <label htmlFor="other-account-id" className="sr-only">
                Destination account ID
              </label>
              <input
                id="other-account-id"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="Account ID"
                value={otherAccountId}
                onChange={(event) => setOtherAccountId(event.target.value)}
                aria-invalid={errors.destination ? true : undefined}
                aria-describedby={errors.destination ? "destination-error" : undefined}
                className={`font-mono ${INPUT_CLASSES} ${errors.destination ? "border-red-400" : "border-slate-300"}`}
              />
            </div>
          )}
          {errors.destination && (
            <p id="destination-error" className="mt-1 text-sm text-red-700">
              {errors.destination}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="transfer-amount" className="block text-sm font-medium text-slate-700">
            Amount ({account.currency})
          </label>
          <div className="mt-1 flex gap-3">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-500">
                $
              </span>
              <input
                id="transfer-amount"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                aria-invalid={errors.amount ? true : undefined}
                aria-describedby={errors.amount ? "transfer-amount-error" : undefined}
                className={`pl-7 ${INPUT_CLASSES} ${errors.amount ? "border-red-400" : "border-slate-300"}`}
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Sending…" : "Transfer"}
            </button>
          </div>
          {errors.amount && (
            <p id="transfer-amount-error" className="mt-1 text-sm text-red-700">
              {errors.amount}
            </p>
          )}
        </div>
      </form>

      {feedback && (
        <p
          role={feedback.kind === "error" ? "alert" : "status"}
          className={`mt-4 rounded-md border px-3 py-2 text-sm ${
            feedback.kind === "error"
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          {feedback.message}
        </p>
      )}

      <p className="mt-4 border-t border-slate-200 pt-4 text-xs text-slate-500">
        To receive a transfer into this account, share its account ID:{" "}
        <code className="font-mono text-slate-700 select-all">{account.id}</code>
      </p>
    </section>
  );
}
