import { BalanceLimitExceededError, InsufficientFundsError } from "../../errors/AppError.js";

/**
 * Balances are BIGINT in the database but handled as JavaScript numbers, which
 * are exact only up to 2^53 - 1. No credit may take a balance past that.
 */
export const MAX_BALANCE = Number.MAX_SAFE_INTEGER;

/** Balance after adding `amount` cents. Integer arithmetic only. */
export function credit(balance: number, amount: number, limitMessage?: string): number {
  if (amount > MAX_BALANCE - balance) {
    throw new BalanceLimitExceededError(limitMessage);
  }
  return balance + amount;
}

/** Balance after removing `amount` cents. Balances never go below zero. */
export function debit(balance: number, amount: number, insufficientMessage?: string): number {
  if (amount > balance) {
    throw new InsufficientFundsError(insufficientMessage);
  }
  return balance - amount;
}
