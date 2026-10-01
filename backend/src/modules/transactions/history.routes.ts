import { Router } from "express";
import { GET_ONLY, methodNotAllowed } from "../../middleware/methodNotAllowed.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { listTransactions } from "./history.controller.js";

/** The authenticated customer's transaction history, mounted at /transactions. */
export function createTransactionHistoryRouter(): Router {
  const router = Router();

  router.use(requireAuth);
  router.route("/").get(listTransactions).all(methodNotAllowed(GET_ONLY));

  return router;
}
