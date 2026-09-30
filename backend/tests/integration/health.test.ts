import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";

const app = createApp();

describe("GET /api/v1/health", () => {
  it("returns 200 with an ok status", async () => {
    const res = await request(app).get("/api/v1/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { status: "ok" } });
  });

  it("echoes a request id header", async () => {
    const res = await request(app).get("/api/v1/health").set("X-Request-Id", "test-id-123");

    expect(res.headers["x-request-id"]).toBe("test-id-123");
  });
});

describe("unknown routes", () => {
  it("returns a 404 error envelope", async () => {
    const res = await request(app).get("/api/v1/does-not-exist");

    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({
      code: "NOT_FOUND",
      requestId: expect.any(String),
    });
  });
});
