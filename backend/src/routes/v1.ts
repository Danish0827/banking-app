import { Router } from "express";
import { healthRouter } from "../modules/health/health.routes.js";

export const v1Router = Router();

v1Router.use("/health", healthRouter);
