import { apiFetch } from "./api";

export type AccountType = "checking" | "savings";

export interface Account {
  id: string;
  accountNumber: string;
  type: AccountType;
  currency: string;
  /** Balance in minor units (cents). Always an integer; format it for display. */
  balance: number;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

export async function listAccounts(signal?: AbortSignal): Promise<Account[]> {
  const { accounts } = await apiFetch<{ accounts: Account[] }>("/accounts", { signal });
  return accounts;
}

export async function getAccount(accountId: string, signal?: AbortSignal): Promise<Account> {
  const { account } = await apiFetch<{ account: Account }>(
    `/accounts/${encodeURIComponent(accountId)}`,
    { signal },
  );
  return account;
}
