import { Router } from "express";
import { GET_ONLY, methodNotAllowed } from "../../middleware/methodNotAllowed.js";
import { createReadinessHandler, getHealth, type ReadinessOptions } from "./health.controller.js";

/** Liveness at /health and readiness at /health/ready. Neither requires a session. */
export function createHealthRouter(readiness: ReadinessOptions): Router {
  const router = Router();

  router.route("/").get(getHealth).all(methodNotAllowed(GET_ONLY));
  router.route("/ready").get(createReadinessHandler(readiness)).all(methodNotAllowed(GET_ONLY));

  return router;
}
