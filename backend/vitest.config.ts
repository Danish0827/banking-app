import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/setup/globalSetup.ts"],
    setupFiles: ["tests/setup/closePool.ts"],
    // Test files share one database, so they must not run concurrently.
    fileParallelism: false,
    env: {
      // NODE_ENV=test makes the app use TEST_DATABASE_URL (see src/config/env.ts).
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      // Test-only signing key; never used outside the test run.
      SESSION_SECRET: "test-only-session-secret-0123456789abcdef",
      // The suite deliberately fires bursts of money movements (concurrency and
      // idempotency tests) far beyond what a person does. The limiter itself is
      // tested with an explicit small limit (tests/integration/security).
      MONEY_RATE_LIMIT_PER_MINUTE: "10000",
    },
  },
});
