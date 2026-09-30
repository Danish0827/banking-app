import { randomBytes } from "node:crypto";
import { pool } from "../../db/pool.js";
import { InvalidCredentialsError, UnauthenticatedError } from "../../errors/AppError.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { findCustomerByEmailForLogin, findCustomerById } from "../customers/customer.repository.js";
import type { Customer } from "../customers/customer.types.js";
import type { AuthContext } from "./auth.types.js";

// Hash of a random value nobody knows. When the email is unknown the password
// is still checked against this, so the response takes as long as it does for
// a real account and timing does not reveal which emails are registered.
const decoyPasswordHash = hashPassword(randomBytes(32).toString("hex"));

/**
 * Verifies an email and password. Fails with the same error whether the email
 * is unknown or the password is wrong.
 */
export async function login(email: string, password: string): Promise<Customer> {
  const customer = await findCustomerByEmailForLogin(pool, email);

  const passwordMatches = await verifyPassword(
    password,
    customer?.passwordHash ?? (await decoyPasswordHash),
  );

  if (!customer || !passwordMatches) {
    throw new InvalidCredentialsError();
  }

  // Copy the safe fields explicitly so the hash can never ride along.
  return { id: customer.id, email: customer.email, fullName: customer.fullName };
}

/** Loads the customer behind a session. A session for a deleted customer is invalid. */
export async function getCurrentCustomer(auth: AuthContext): Promise<Customer> {
  const customer = await findCustomerById(pool, auth.customerId);
  if (!customer) {
    throw new UnauthenticatedError();
  }
  return customer;
}
