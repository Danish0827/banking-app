import type { RequestHandler } from "express";
import { sendError } from "./errorResponse.js";

export const notFound: RequestHandler = (req, res) => {
  sendError(req, res, {
    status: 404,
    code: "NOT_FOUND",
    // The path is not echoed back: it is caller-controlled input.
    message: "Route not found",
  });
};
