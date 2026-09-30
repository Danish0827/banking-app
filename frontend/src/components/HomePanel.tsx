"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getCurrentCustomer, logout, type Customer } from "@/lib/auth";

type SessionState =
  { status: "loading" } | { status: "authenticated"; customer: Customer } | { status: "error" };

/**
 * Landing page for a signed-in customer. Visitors without a session are sent
 * to the login page. The API enforces access; this only decides what to show.
 */
export function HomePanel() {
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
      <p className="text-sm text-slate-600" role="status">
        Loading…
      </p>
    );
  }

  if (session.status === "error") {
    return (
      <p role="alert" className="text-sm text-red-700">
        We couldn&apos;t reach the server. Please refresh the page in a moment.
      </p>
    );
  }

  const { customer } = session;

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome, {customer.fullName}</h1>
          <p className="mt-1 text-sm text-slate-600">Signed in as {customer.email}</p>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className="shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {loggingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
      <p className="mt-6 text-sm text-slate-600">Your accounts will appear here.</p>
    </div>
  );
}
