import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { resolveRequestId } from "../../src/middleware/requestLogger.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("resolveRequestId", () => {
  it.each(["abc-123", "trace_01.span-02", "A".repeat(64)])("keeps the safe id %j", (id) => {
    expect(resolveRequestId(id)).toBe(id);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["too long", "a".repeat(65)],
    ["containing spaces", "abc 123"],
    ["containing a newline", "abc\ninjected log line"],
    ["containing markup", "<script>alert(1)</script>"],
    ["containing JSON", '{"level":60}'],
    ["repeated (array)", ["a", "b"]],
  ])("replaces an id that is %s with a generated UUID", (_label, incoming) => {
    expect(resolveRequestId(incoming)).toMatch(UUID);
  });
});

describe("X-Request-Id header", () => {
  const app = createApp();

  it("echoes a safe incoming id", async () => {
    const res = await request(app).get("/api/v1/health").set("X-Request-Id", "client-id-42");

    expect(res.headers["x-request-id"]).toBe("client-id-42");
  });

  it("replaces an unsafe incoming id instead of reflecting it", async () => {
    const res = await request(app)
      .get("/api/v1/does-not-exist")
      .set("X-Request-Id", "<script>alert(1)</script>");

    expect(res.headers["x-request-id"]).toMatch(UUID);
    expect(res.body.error.requestId).toBe(res.headers["x-request-id"]);
  });
});
