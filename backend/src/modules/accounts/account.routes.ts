import { Router } from "express";
import { GET_ONLY, methodNotAllowed } from "../../middleware/methodNotAllowed.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { validateParams } from "../../middleware/validate.js";
import { getAccount, listAccounts } from "./account.controller.js";
import { accountParamsSchema } from "./account.schemas.js";

export function createAccountRouter(): Router {
  const router = Router();

  // Every account route requires a session; the customer is taken from it.
  router.use(requireAuth);

  router.route("/").get(listAccounts).all(methodNotAllowed(GET_ONLY));
  router
    .route("/:accountId")
    .get(validateParams(accountParamsSchema), getAccount)
    .all(methodNotAllowed(GET_ONLY));

  return router;
}
