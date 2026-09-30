import type { RequestHandler } from "express";
import { getAuth } from "../../middleware/requireAuth.js";
import type { LoginInput } from "./auth.schemas.js";
import * as authService from "./auth.service.js";
import { clearSessionCookie, createSessionToken, setSessionCookie } from "./session.js";

export const login: RequestHandler = async (req, res) => {
  const { email, password } = req.body as LoginInput;

  const customer = await authService.login(email, password);
  setSessionCookie(res, await createSessionToken(customer.id));

  res.status(200).json({ data: { customer } });
};

export const logout: RequestHandler = (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
};

export const me: RequestHandler = async (req, res) => {
  const customer = await authService.getCurrentCustomer(getAuth(req));

  res.status(200).json({ data: { customer } });
};
