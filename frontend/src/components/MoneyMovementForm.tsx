"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { Account } from "@/lib/accounts";
import { ApiError } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { parseAmountToCents } from "@/lib/money";
import { moveMoney, type MovementType } from "@/lib/transactions";
import { isOutcomeUnknown, useIdempotencyKey } from "@/lib/useIdempotencyKey";

type Feedback = { kind: "success" | "error"; message: string } | null;

const LABELS: Record<MovementType, { action: string; done: string; noun: string }> = {
  deposit: { action: "Deposit", done: "Deposited", noun: "deposit" },
  withdrawal: { action: "Withdraw", done: "Withdrew", noun: "withdrawal" },
};

function errorMessage(err: unknown, type: MovementType, account: Account): string {
  if (!(err instanceof ApiError)) {
    return "Something went wrong. Please try again.";
  }
  switch (err.code) {
    case "INSUFFICIENT_FUNDS":
      return `Insufficient funds. The available balance is ${formatMoney(account.balance, account.currency)}.`;
    case "VALIDATION_ERROR":
      return "Please enter a valid amount.";
    case "BALANCE_LIMIT_EXCEEDED":
      return "This deposit would take the account over its maximum balance.";
    case "ACCOUNT_NOT_FOUND":
      return "This account is no longer available.";
    case "IDEMPOTENCY_CONFLICT":
      return "This request clashed with an earlier one. Please try again.";
    default:
      return isOutcomeUnknown(err)
        ? `We couldn't confirm the ${LABELS[type].noun}. Submitting the same amount again is safe: it will not be applied twice.`
        : "Something went wrong. Please try again.";
  }
}

/**
 * Deposit and withdrawal form for one account.
 *
 * Every new action gets a fresh Idempotency-Key. If the outcome of a request
 * is unknown (network failure or server error), the key is kept: submitting
 * the same operation and amount again reuses it, so the server applies the
 * action at most once. Changing the operation or amount starts a new action.
 *
 * Balances shown on the page come from the server: after success the account
 * is re-fetched, never adjusted locally.
 */
export function MoneyMovementForm({
  account,
  onCompleted,
}: {
  account: Account;
  onCompleted: () => void;
}) {
  const router = useRouter();
  const [type, setType] = useState<MovementType>("deposit");
  const [amount, setAmount] = useState("");
  const [fieldError, setFieldError] = useState<string>();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [submitting, setSubmitting] = useState(false);
  const idempotency = useIdempotencyKey();

  function selectType(next: MovementType) {
    setType(next);
    setFieldError(undefined);
    setFeedback(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const parsed = parseAmountToCents(amount);
    setFeedback(null);
    if (!parsed.ok) {
      setFieldError(parsed.error);
      return;
    }
    setFieldError(undefined);

    const idempotencyKey = idempotency.keyFor(`${type}:${parsed.cents}`);

    setSubmitting(true);
    try {
      await moveMoney(type, account.id, parsed.cents, idempotencyKey);
      idempotency.settle();
      setAmount("");
      setFeedback({
        kind: "success",
        message: `${LABELS[type].done} ${formatMoney(parsed.cents, account.currency)}.`,
      });
      onCompleted();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      idempotency.settle(err);
      setFeedback({ kind: "error", message: errorMessage(err, type, account) });
    } finally {
      setSubmitting(false);
    }
  }

  const tabClasses = (selected: boolean) =>
    `flex-1 rounded px-3 py-1.5 text-sm font-medium ${
      selected ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
    }`;

  return (
    <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold tracking-tight">Move money</h2>

      <div
        role="group"
        aria-label="Operation"
        className="mt-4 flex gap-1 rounded-md bg-slate-100 p-1"
      >
        {(["deposit", "withdrawal"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={type === option}
            onClick={() => selectType(option)}
            className={tabClasses(type === option)}
          >
            {LABELS[option].action}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} noValidate className="mt-4">
        <label htmlFor="amount" className="block text-sm font-medium text-slate-700">
          Amount ({account.currency})
        </label>
        <div className="mt-1 flex gap-3">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-500">
              $
            </span>
            <input
              id="amount"
              name="amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? "amount-error" : "amount-hint"}
              className={`block w-full rounded-md border py-2 pr-3 pl-7 text-sm shadow-sm outline-none focus:ring-2 focus:ring-slate-900/20 ${
                fieldError ? "border-red-400" : "border-slate-300"
              }`}
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Processing…" : LABELS[type].action}
          </button>
        </div>
        {fieldError ? (
          <p id="amount-error" className="mt-1 text-sm text-red-700">
            {fieldError}
          </p>
        ) : (
          <p id="amount-hint" className="mt-1 text-xs text-slate-500">
            Up to $1,000,000.00 per transaction.
          </p>
        )}
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
    </section>
  );
}
