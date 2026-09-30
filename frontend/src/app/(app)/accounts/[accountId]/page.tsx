import type { Metadata } from "next";
import { AccountDetail } from "@/components/AccountDetail";

export const metadata: Metadata = {
  title: "Account | Banking App",
};

export default async function AccountPage({ params }: PageProps<"/accounts/[accountId]">) {
  const { accountId } = await params;

  // Keyed by id so moving between accounts starts from a clean loading state.
  return <AccountDetail key={accountId} accountId={accountId} />;
}
