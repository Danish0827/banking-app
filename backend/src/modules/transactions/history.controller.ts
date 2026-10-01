import type { RequestHandler } from "express";
import { getAuth } from "../../middleware/requireAuth.js";
import { parseOrThrow } from "../../middleware/validate.js";
import { historyQuerySchema } from "./history.schemas.js";
import * as historyService from "./history.service.js";

export const listTransactions: RequestHandler = async (req, res) => {
  const query = parseOrThrow(historyQuerySchema, req.query);
  const page = await historyService.listHistory(getAuth(req), query);

  res.status(200).json({ data: page });
};
