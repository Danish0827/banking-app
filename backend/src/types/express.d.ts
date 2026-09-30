import type { AuthContext } from "../modules/auth/auth.types.js";

declare global {
  namespace Express {
    interface Request {
      /** Present once `requireAuth` has verified the session. */
      auth?: AuthContext;
    }
  }
}
