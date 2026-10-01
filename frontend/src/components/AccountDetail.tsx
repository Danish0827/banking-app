"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { getAccount } from "@/lib/accounts";
import { formatAccountType, formatDate, formatMoney, maskAccountNumber } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { MoneyMovementForm } from "./MoneyMovementForm";
import { TransferForm } from "./TransferForm";

const BACK_LINK_CLASSES = "text-sm font-medium text-slate-600 hover:text-slate-900";

export function AccountDetail({ accountId }: { accountId: string }) {
  const load = useCallback((signal: AbortSignal) => getAccount(accountId, signal), [accountId]);
  const account = useApiData(load);
  const [showNumber, setShowNumber] = useState(false);

  if (account.status === "loading") {
    return (
      <p className="text-sm text-slate-600" role="status">
        Loading account…
      </p>
    );
  }

  if (account.status === "error") {
    // The API answers the same way for an account that doesn't exist and one
    // that belongs to someone else, and so does this page.
    const notFound = account.error?.status === 404 || account.error?.status === 400;

    return (
      <div>
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {notFound
            ? "We couldn't find that account."
            : "We couldn't load this account. Please refresh the page to try again."}
        </p>
        <p className="mt-4">
          <Link href="/" className={BACK_LINK_CLASSES}>
            ← Back to accounts
          </Link>
        </p>
      </div>
    );
  }

  const { data } = account;

  return (
    <div>
      <Link href="/" className={BACK_LINK_CLASSES}>
        ← Back to accounts
      </Link>

      <section className="mt-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight">
          {formatAccountType(data.type)} account
        </h1>

        <p className="mt-6 text-sm text-slate-600">Current balance</p>
        <p className="text-3xl font-semibold tracking-tight tabular-nums">
          {formatMoney(data.balance, data.currency)}
        </p>

        <dl className="mt-6 grid gap-4 border-t border-slate-200 pt-6 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-slate-600">Account number</dt>
            <dd className="mt-1 flex items-center gap-2">
              <span className="font-mono">
                {showNumber ? data.accountNumber : maskAccountNumber(data.accountNumber)}
              </span>
              <button
                type="button"
                onClick={() => setShowNumber((shown) => !shown)}
                aria-pressed={showNumber}
                className="text-xs font-medium text-slate-600 underline hover:text-slate-900"
              >
                {showNumber ? "Hide" : "Show"}
              </button>
            </dd>
          </div>
          <div>
            <dt className="text-slate-600">Currency</dt>
            <dd className="mt-1">{data.currency}</dd>
          </div>
          <div>
            <dt className="text-slate-600">Opened</dt>
            <dd className="mt-1">{formatDate(data.createdAt)}</dd>
          </div>
        </dl>
      </section>

      <MoneyMovementForm account={data} onCompleted={account.reload} />
      <TransferForm account={data} onCompleted={account.reload} />
    </div>
  );
}
