export type AccountType = "checking" | "savings";

export interface SeedAccount {
  id: string;
  accountNumber: string;
  type: AccountType;
  /** Opening balance in cents. */
  openingBalance: number;
}

export interface SeedCustomer {
  id: string;
  email: string;
  fullName: string;
  accounts: SeedAccount[];
}

/** Shared password for every demo customer. Demo data only. */
export const DEMO_PASSWORD = "Demo-Password-123";

// Fixed ids and account numbers keep the seed deterministic: every environment
// gets identical demo data, and re-running the seed can recognise what exists.
export const SEED_CUSTOMERS: SeedCustomer[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    email: "alice@example.com",
    fullName: "Alice Johnson",
    accounts: [
      {
        id: "00000000-0000-4000-8000-000000000101",
        accountNumber: "1000000001",
        type: "checking",
        openingBalance: 250_000,
      },
      {
        id: "00000000-0000-4000-8000-000000000102",
        accountNumber: "1000000002",
        type: "savings",
        openingBalance: 1_000_000,
      },
    ],
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    email: "bob@example.com",
    fullName: "Bob Smith",
    accounts: [
      {
        id: "00000000-0000-4000-8000-000000000103",
        accountNumber: "1000000003",
        type: "checking",
        openingBalance: 120_000,
      },
    ],
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    email: "carol@example.com",
    fullName: "Carol Davis",
    accounts: [
      {
        id: "00000000-0000-4000-8000-000000000104",
        accountNumber: "1000000004",
        type: "checking",
        openingBalance: 50_000,
      },
      {
        id: "00000000-0000-4000-8000-000000000105",
        accountNumber: "1000000005",
        type: "savings",
        openingBalance: 0,
      },
    ],
  },
];
