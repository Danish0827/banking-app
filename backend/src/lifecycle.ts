/**
 * Process-wide lifecycle state. Once shutdown has begun the readiness check
 * reports "not ready", so a load balancer stops sending new traffic while
 * in-flight requests finish.
 */
let shuttingDown = false;

export function markShuttingDown(): void {
  shuttingDown = true;
}

export function isShuttingDown(): boolean {
  return shuttingDown;
}
