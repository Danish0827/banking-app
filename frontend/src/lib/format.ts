import type { AccountType } from "./accounts";

/**
 * Formats an integer amount of minor units (cents) for display, e.g.
 * 250000 -> "$2,500.00". The whole and fractional parts are split with
 * integer arithmetic, so no floating-point rounding is involved.
 */
export function formatMoney(minorUnits: number, currency: string = "USD"): string {
  const absolute = Math.abs(minorUnits);
  const fraction = absolute % 100;
  const whole = (absolute - fraction) / 100;

  const formattedWhole = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(whole);

  return `${minorUnits < 0 ? "-" : ""}${formattedWhole}.${String(fraction).padStart(2, "0")}`;
}

/** Shows only the last four digits of an account number, e.g. "****0001". */
export function maskAccountNumber(accountNumber: string): string {
  return `****${accountNumber.slice(-4)}`;
}

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: "Checking",
  savings: "Savings",
};

export function formatAccountType(type: AccountType): string {
  return ACCOUNT_TYPE_LABELS[type] ?? type;
}

export function formatDate(isoTimestamp: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(new Date(isoTimestamp));
}
