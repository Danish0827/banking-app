export type AccountType = "checking" | "savings";

/** An account as exposed by the API to its owner. */
export interface Account {
  id: string;
  accountNumber: string;
  type: AccountType;
  currency: string;
  /** Current balance in minor units (cents). Always an integer. */
  balance: number;
  createdAt: Date;
}
