"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { listAccounts, type Account } from "@/lib/accounts";
import { ApiError } from "@/lib/api";
import { formatAccountType, formatMoney, maskAccountNumber } from "@/lib/format";
import {
  listTransactions,
  type HistoryFilters,
  type HistoryItem,
  type TransactionType,
} from "@/lib/history";
import { useApiData } from "@/lib/useApiData";

const PAGE_SIZE = 10;

interface FilterForm {
  accountId: string;
  type: "" | TransactionType;
  /** yyyy-mm-dd from <input type="date">, in the user's time zone. */
  fromDate: string;
  toDate: string;
}

type ListState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; items: HistoryItem[]; nextCursor: string | null };

/** Local midnight of a yyyy-mm-dd date, as an ISO timestamp. */
function localMidnight(date: string, addDays = 0): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year!, month! - 1, day! + addDays).toISOString();
}

/** The user picks whole days in their own time zone; "to" includes the whole day. */
function toApiFilters(form: FilterForm): HistoryFilters {
  return {
    accountId: form.accountId || undefined,
    type: form.type || undefined,
    from: form.fromDate ? localMidnight(form.fromDate) : undefined,
    to: form.toDate ? localMidnight(form.toDate, 1) : undefined,
  };
}

function accountLabel(account: Account | undefined): string {
  return account
    ? `${formatAccountType(account.type)} ${maskAccountNumber(account.accountNumber)}`
    : "Your account";
}

/** What happened, from the customer's point of view. Never names another customer. */
function describe(item: HistoryItem, accounts: Map<string, Account>): string {
  if (item.type === "deposit") return "Deposit";
  if (item.type === "withdrawal") return "Withdrawal";

  const other = item.counterparty;
  if (item.direction === "debit") {
    return other?.ownedByYou && other.accountId
      ? `Transfer to ${accountLabel(accounts.get(other.accountId))}`
      : "Transfer sent to another customer";
  }
  return other?.ownedByYou && other.accountId
    ? `Transfer from ${accountLabel(accounts.get(other.accountId))}`
    : "Transfer received from another customer";
}

const dateTimeFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

const INPUT_CLASSES =
  "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-slate-900/20";

/**
 * The signed-in customer's transaction history: filters, a table of entries
 * (newest first) and "Load more" paging through the API's cursor. Everything
 * shown comes from the API, which only returns the customer's own entries.
 */
export function TransactionHistory({ initialAccountId }: { initialAccountId?: string }) {
  const router = useRouter();
  const accounts = useApiData(listAccounts);
  const accountsById = useMemo(
    () => new Map(accounts.status === "success" ? accounts.data.map((a) => [a.id, a]) : []),
    [accounts],
  );

  const emptyForm: FilterForm = { accountId: "", type: "", fromDate: "", toDate: "" };
  const [form, setForm] = useState<FilterForm>({ ...emptyForm, accountId: initialAccountId ?? "" });
  const [filters, setFilters] = useState<HistoryFilters>(() => toApiFilters(form));
  const [formError, setFormError] = useState<string>();
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);

  function handleError(err: unknown): boolean {
    if (err instanceof ApiError && err.status === 401) {
      router.replace("/login");
      return true;
    }
    return false;
  }

  // First page whenever the applied filters change.
  useEffect(() => {
    const controller = new AbortController();
    listTransactions(filters, { limit: PAGE_SIZE }, controller.signal)
      .then((page) =>
        setList({ status: "ready", items: page.transactions, nextCursor: page.nextCursor }),
      )
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
          return;
        }
        setList({ status: "error" });
      });
    return () => controller.abort();
  }, [filters, router]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.fromDate && form.toDate && form.toDate < form.fromDate) {
      setFormError("The end date must be on or after the start date.");
      return;
    }
    setFormError(undefined);
    setList({ status: "loading" });
    setLoadMoreFailed(false);
    setFilters(toApiFilters(form));
  }

  function clearFilters() {
    setForm(emptyForm);
    setFormError(undefined);
    setList({ status: "loading" });
    setLoadMoreFailed(false);
    setFilters({});
  }

  async function loadMore() {
    if (list.status !== "ready" || !list.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const page = await listTransactions(filters, { limit: PAGE_SIZE, cursor: list.nextCursor });
      setList({
        status: "ready",
        items: [...list.items, ...page.transactions],
        nextCursor: page.nextCursor,
      });
    } catch (err) {
      if (!handleError(err)) setLoadMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }

  const filtered = Object.values(filters).some(Boolean);

  return (
    <div>
      <form
        onSubmit={applyFilters}
        noValidate
        className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-4"
        aria-label="Filter transactions"
      >
        <div>
          <label htmlFor="filter-account" className="block text-sm font-medium text-slate-700">
            Account
          </label>
          <select
            id="filter-account"
            value={form.accountId}
            onChange={(event) => setForm({ ...form, accountId: event.target.value })}
            className={INPUT_CLASSES}
          >
            <option value="">All accounts</option>
            {accounts.status === "success" &&
              accounts.data.map((account) => (
                <option key={account.id} value={account.id}>
                  {accountLabel(account)}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label htmlFor="filter-type" className="block text-sm font-medium text-slate-700">
            Type
          </label>
          <select
            id="filter-type"
            value={form.type}
            onChange={(event) =>
              setForm({ ...form, type: event.target.value as FilterForm["type"] })
            }
            className={INPUT_CLASSES}
          >
            <option value="">All types</option>
            <option value="deposit">Deposits</option>
            <option value="withdrawal">Withdrawals</option>
            <option value="transfer">Transfers</option>
          </select>
        </div>
        <div>
          <label htmlFor="filter-from" className="block text-sm font-medium text-slate-700">
            From
          </label>
          <input
            id="filter-from"
            type="date"
            value={form.fromDate}
            onChange={(event) => setForm({ ...form, fromDate: event.target.value })}
            className={INPUT_CLASSES}
          />
        </div>
        <div>
          <label htmlFor="filter-to" className="block text-sm font-medium text-slate-700">
            To
          </label>
          <input
            id="filter-to"
            type="date"
            value={form.toDate}
            onChange={(event) => setForm({ ...form, toDate: event.target.value })}
            aria-invalid={formError ? true : undefined}
            aria-describedby={formError ? "filter-error" : undefined}
            className={INPUT_CLASSES}
          />
        </div>
        <div className="flex items-center gap-3 sm:col-span-4">
          <button
            type="submit"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Apply filters
          </button>
          <button
            type="button"
            onClick={clearFilters}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Clear
          </button>
          {formError && (
            <p id="filter-error" className="text-sm text-red-700">
              {formError}
            </p>
          )}
        </div>
      </form>

      <div className="mt-6">
        {list.status === "loading" && (
          <p className="text-sm text-slate-600" role="status">
            Loading transactions…
          </p>
        )}

        {list.status === "error" && (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            We couldn&apos;t load your transactions. Please refresh the page to try again.
          </p>
        )}

        {list.status === "ready" && list.items.length === 0 && (
          <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-600">
            {filtered
              ? "No transactions match these filters."
              : "You don't have any transactions yet."}
          </p>
        )}

        {list.status === "ready" && list.items.length > 0 && (
          <>
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600 uppercase">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Date
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Description
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Account
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      Amount
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      Balance after
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {list.items.map((item) => (
                    <tr key={`${item.transactionId}:${item.accountId}`}>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                        {dateTimeFormat.format(new Date(item.createdAt))}
                      </td>
                      <td className="px-4 py-3">{describe(item, accountsById)}</td>
                      <td className="px-4 py-3 whitespace-nowrap font-mono text-slate-600">
                        {accountLabel(accountsById.get(item.accountId))}
                      </td>
                      <td
                        className={`px-4 py-3 text-right whitespace-nowrap tabular-nums ${
                          item.direction === "credit" ? "text-emerald-700" : "text-slate-900"
                        }`}
                      >
                        {item.direction === "credit" ? "+" : "−"}
                        {formatMoney(item.amount, item.currency)}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap text-slate-600 tabular-nums">
                        {formatMoney(item.balanceAfter, item.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center justify-between gap-4 text-sm text-slate-600">
              <span role="status">
                Showing {list.items.length} transaction{list.items.length === 1 ? "" : "s"}
                {list.nextCursor ? "" : " (all loaded)"}
              </span>
              {list.nextCursor && (
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="rounded-md border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              )}
            </div>
            {loadMoreFailed && (
              <p role="alert" className="mt-2 text-sm text-red-700">
                We couldn&apos;t load more transactions. Please try again.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
