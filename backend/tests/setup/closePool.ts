import { afterAll } from "vitest";
import { pool } from "../../src/db/pool.js";

// Each test file gets its own module graph and therefore its own pool; close
// it so no connections outlive the file.
afterAll(async () => {
  await pool.end();
});
