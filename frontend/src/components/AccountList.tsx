"use client";

import Link from "next/link";
import { listAccounts } from "@/lib/accounts";
import { formatAccountType, formatMoney, maskAccountNumber } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";

export function AccountList() {
  const accounts = useApiData(listAccounts);

  if (accounts.status === "loading") {
    return (
      <p className="text-sm text-slate-600" role="status">
        Loading your accounts…
      </p>
    );
  }

  if (accounts.status === "error") {
    return (
      <p
        role="alert"
        className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
      >
        We couldn&apos;t load your accounts. Please refresh the page to try again.
      </p>
    );
  }

  if (accounts.data.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-600">
        You don&apos;t have any accounts yet.
      </p>
    );
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {accounts.data.map((account) => (
        <li key={account.id}>
          <Link
            href={`/accounts/${account.id}`}
            className="block rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-slate-400 focus-visible:outline-2 focus-visible:outline-slate-900"
          >
            <p className="text-sm font-medium text-slate-900">{formatAccountType(account.type)}</p>
            <p className="mt-0.5 font-mono text-sm text-slate-500">
              {maskAccountNumber(account.accountNumber)}
            </p>
            <p className="mt-4 text-2xl font-semibold tracking-tight tabular-nums">
              {formatMoney(account.balance, account.currency)}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">{account.currency}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
