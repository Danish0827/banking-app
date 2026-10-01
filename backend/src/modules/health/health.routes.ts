import { Router } from "express";
import { GET_ONLY, methodNotAllowed } from "../../middleware/methodNotAllowed.js";
import { getHealth } from "./health.controller.js";

export const healthRouter = Router();

healthRouter.route("/").get(getHealth).all(methodNotAllowed(GET_ONLY));
