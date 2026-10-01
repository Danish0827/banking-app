import type { Metadata } from "next";
import { TransactionHistory } from "@/components/TransactionHistory";

export const metadata: Metadata = {
  title: "Transactions | Banking App",
};

export default async function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  const { accountId } = await searchParams;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
      <div className="mt-6">
        <TransactionHistory
          initialAccountId={typeof accountId === "string" ? accountId : undefined}
        />
      </div>
    </>
  );
}
