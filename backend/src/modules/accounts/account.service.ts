import { pool } from "../../db/pool.js";
import { AccountNotFoundError } from "../../errors/AppError.js";
import type { AuthContext } from "../auth/auth.types.js";
import { findAccountByIdForCustomer, findAccountsByCustomerId } from "./account.repository.js";
import type { Account } from "./account.types.js";

/** Lists the accounts owned by the authenticated customer. */
export function listAccounts(auth: AuthContext): Promise<Account[]> {
  return findAccountsByCustomerId(pool, auth.customerId);
}

/**
 * Returns one of the authenticated customer's accounts. An unknown id and an
 * account owned by another customer fail identically.
 */
export async function getAccount(auth: AuthContext, accountId: string): Promise<Account> {
  const account = await findAccountByIdForCustomer(pool, accountId, auth.customerId);
  if (!account) {
    throw new AccountNotFoundError();
  }
  return account;
}
