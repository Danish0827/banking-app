import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { validateBody } from "../../middleware/validate.js";
import { login, logout, me } from "./auth.controller.js";
import { loginSchema } from "./auth.schemas.js";
import { createLoginRateLimiter } from "./loginRateLimiter.js";

export function createAuthRouter(): Router {
  const router = Router();

  // Validation runs first: the rate limiter keys on the validated email.
  router.post("/login", validateBody(loginSchema), createLoginRateLimiter(), login);
  router.post("/logout", logout);
  router.get("/me", requireAuth, me);

  return router;
}
