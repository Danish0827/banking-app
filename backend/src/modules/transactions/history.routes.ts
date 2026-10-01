import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { listTransactions } from "./history.controller.js";

/** The authenticated customer's transaction history, mounted at /transactions. */
export function createTransactionHistoryRouter(): Router {
  const router = Router();

  router.use(requireAuth);
  router.get("/", listTransactions);

  return router;
}
