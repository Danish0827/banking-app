/**
 * Who is making the current request. Set by `requireAuth` from a verified
 * session and passed to services, which use it for ownership checks. Services
 * take this instead of an Express request so they stay independent of HTTP.
 */
export interface AuthContext {
  customerId: string;
}
