import bcrypt from "bcrypt";

/** bcrypt cost factor for stored passwords. */
export const BCRYPT_ROUNDS = 12;

export function hashPassword(password: string, rounds: number = BCRYPT_ROUNDS): Promise<string> {
  return bcrypt.hash(password, rounds);
}

export function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}
