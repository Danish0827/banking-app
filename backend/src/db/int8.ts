/**
 * Parser for PostgreSQL BIGINT (int8) values.
 *
 * `pg` returns BIGINT as a string because it can exceed the range a JavaScript
 * number represents exactly. Money in this application is BIGINT cents and is
 * capped far below 2^53, so a number is the convenient representation. Rather
 * than silently losing precision if that assumption is ever broken, a value
 * outside the safe integer range throws.
 */
export function parseInt8(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError(`BIGINT value ${value} is outside the safe integer range`);
  }
  return parsed;
}
