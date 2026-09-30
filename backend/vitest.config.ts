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
    },
  },
});
