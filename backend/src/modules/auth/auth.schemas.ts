import { z } from "zod";

export const loginSchema = z.object({
  email: z
    .string({ error: "Email is required" })
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: "Enter a valid email address" }).max(254)),
  // Not trimmed: whitespace can be part of a password. The cap bounds the work
  // an attacker can force per attempt.
  password: z
    .string({ error: "Password is required" })
    .min(1, { error: "Password is required" })
    .max(128, { error: "Password is too long" }),
});

export type LoginInput = z.infer<typeof loginSchema>;
