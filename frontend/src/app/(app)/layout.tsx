import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";

/** Layout shared by every page that requires a signed-in customer. */
export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
