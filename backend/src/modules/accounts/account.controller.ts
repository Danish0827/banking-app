import type { RequestHandler } from "express";
import { getAuth } from "../../middleware/requireAuth.js";
import type { AccountParams } from "./account.schemas.js";
import * as accountService from "./account.service.js";

export const listAccounts: RequestHandler = async (req, res) => {
  const accounts = await accountService.listAccounts(getAuth(req));

  res.status(200).json({ data: { accounts } });
};

export const getAccount: RequestHandler<AccountParams> = async (req, res) => {
  const account = await accountService.getAccount(getAuth(req), req.params.accountId);

  res.status(200).json({ data: { account } });
};
