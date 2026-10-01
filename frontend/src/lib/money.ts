/** Largest single deposit or withdrawal, in cents ($1,000,000.00). Matches the API. */
export const MAX_AMOUNT_CENTS = 100_000_000;

// Dollars with optional thousands separators and at most two decimal places:
// "25", "25.5", "25.50", "1,250.00". No signs, exponents or bare ".50".
const AMOUNT_PATTERN = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

export type AmountParseResult = { ok: true; cents: number } | { ok: false; error: string };

/**
 * Converts a dollar amount typed by the user into integer cents without any
 * floating-point arithmetic: the text is split into whole dollars and cents
 * and each part is parsed as an integer. "10.10" becomes exactly 1010.
 */
export function parseAmountToCents(input: string): AmountParseResult {
  const text = input.trim().replace(/^\$\s*/, "");
  if (text === "") {
    return { ok: false, error: "Enter an amount." };
  }

  const match = AMOUNT_PATTERN.exec(text);
  if (!match) {
    return { ok: false, error: "Enter an amount in dollars and cents, for example 25.00." };
  }

  const dollars = (match[1] ?? "").replaceAll(",", "").replace(/^0+(?=\d)/, "");
  const cents = (match[2] ?? "").padEnd(2, "0");

  // Anything with more than 7 dollar digits is over the limit; checking the
  // length first keeps every number below well inside the safe integer range.
  const tooLarge = { ok: false as const, error: "The maximum per transaction is $1,000,000.00." };
  if (dollars.length > 7) {
    return tooLarge;
  }

  const total = Number(dollars) * 100 + Number(cents);
  if (total === 0) {
    return { ok: false, error: "Enter an amount greater than zero." };
  }
  if (total > MAX_AMOUNT_CENTS) {
    return tooLarge;
  }
  return { ok: true, cents: total };
}
