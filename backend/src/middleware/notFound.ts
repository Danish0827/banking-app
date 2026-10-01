import type { RequestHandler } from "express";

export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      // The path is not echoed back: it is caller-controlled input.
      message: "Route not found",
      requestId: String(req.id),
    },
  });
};
