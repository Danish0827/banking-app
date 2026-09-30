"use client";

import { useEffect, useState } from "react";

type Status = "checking" | "online" | "offline";

const LABELS: Record<Status, string> = {
  checking: "Checking…",
  online: "Online",
  offline: "Unreachable",
};

const DOT_STYLES: Record<Status, string> = {
  checking: "bg-slate-400",
  online: "bg-emerald-500",
  offline: "bg-red-500",
};

/** Calls the backend health endpoint through the Next.js `/api` proxy. */
export function ApiStatus() {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/v1/health", { signal: controller.signal })
      .then((res) => setStatus(res.ok ? "online" : "offline"))
      .catch(() => {
        if (!controller.signal.aborted) setStatus("offline");
      });

    return () => controller.abort();
  }, []);

  return (
    <p className="flex items-center justify-between text-sm" role="status">
      <span className="text-slate-600">API status</span>
      <span className="flex items-center gap-2 font-medium">
        <span className={`h-2 w-2 rounded-full ${DOT_STYLES[status]}`} aria-hidden="true" />
        {LABELS[status]}
      </span>
    </p>
  );
}
