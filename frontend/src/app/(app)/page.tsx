import { AccountList } from "@/components/AccountList";

export default function DashboardPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Your accounts</h1>
      <div className="mt-6">
        <AccountList />
      </div>
    </>
  );
}
