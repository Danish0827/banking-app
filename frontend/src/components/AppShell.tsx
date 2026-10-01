"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { getCurrentCustomer, logout, type Customer } from "@/lib/auth";

type SessionState =
  { status: "loading" } | { status: "authenticated"; customer: Customer } | { status: "error" };

/**
 * Frame for the signed-in pages: checks the session, shows who is signed in
 * and offers sign-out. Visitors without a session are sent to the login page.
 * The API enforces access to data; this only decides what to show.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<SessionState>({ status: "loading" });
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    getCurrentCustomer(controller.signal)
      .then((customer) => {
        if (customer) setSession({ status: "authenticated", customer });
        else router.replace("/login");
      })
      .catch(() => {
        if (!controller.signal.aborted) setSession({ status: "error" });
      });

    return () => controller.abort();
  }, [router]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      // Even if the request failed, leave the signed-in view.
      router.replace("/login");
    }
  }

  if (session.status === "loading") {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-slate-600" role="status">
          Loading…
        </p>
      </main>
    );
  }

  if (session.status === "error") {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <p role="alert" className="text-sm text-red-700">
          We couldn&apos;t reach the server. Please refresh the page in a moment.
        </p>
      </main>
    );
  }

  const { customer } = session;

  return (
    <>
      <header className="border-b border-slate-200 bg-white">
        {/* Wraps onto two lines on narrow screens instead of overflowing. */}
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-x-4 gap-y-3 px-6 py-4">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              Banking App
            </Link>
            <nav aria-label="Main" className="flex gap-4 text-sm font-medium text-slate-600">
              <Link href="/" className="hover:text-slate-900">
                Accounts
              </Link>
              <Link href="/transactions" className="hover:text-slate-900">
                Transactions
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden text-sm text-slate-600 sm:inline" title={customer.email}>
              {customer.fullName}
            </span>
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {loggingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">{children}</main>
    </>
  );
}
