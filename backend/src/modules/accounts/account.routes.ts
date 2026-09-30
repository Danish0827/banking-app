import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { validateParams } from "../../middleware/validate.js";
import { getAccount, listAccounts } from "./account.controller.js";
import { accountParamsSchema } from "./account.schemas.js";

export function createAccountRouter(): Router {
  const router = Router();

  // Every account route requires a session; the customer is taken from it.
  router.use(requireAuth);

  router.get("/", listAccounts);
  router.get("/:accountId", validateParams(accountParamsSchema), getAccount);

  return router;
}
