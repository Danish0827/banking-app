import { Router } from "express";
import { GET_ONLY, methodNotAllowed, POST_ONLY } from "../../middleware/methodNotAllowed.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { validateBody } from "../../middleware/validate.js";
import { login, logout, me } from "./auth.controller.js";
import { loginSchema } from "./auth.schemas.js";
import { createLoginRateLimiter } from "./loginRateLimiter.js";

export function createAuthRouter(): Router {
  const router = Router();

  // Validation runs first: the rate limiter keys on the validated email.
  router
    .route("/login")
    .post(validateBody(loginSchema), createLoginRateLimiter(), login)
    .all(methodNotAllowed(POST_ONLY));
  router.route("/logout").post(logout).all(methodNotAllowed(POST_ONLY));
  router.route("/me").get(requireAuth, me).all(methodNotAllowed(GET_ONLY));

  return router;
}
