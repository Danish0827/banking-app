import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";

const app = createApp();

describe("request body errors", () => {
  it("returns 400 for malformed JSON", async () => {
    const res = await request(app)
      .post("/api/v1/health")
      .set("Content-Type", "application/json")
      .send('{"amount": ');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: "INVALID_JSON",
      requestId: expect.any(String),
    });
  });

  it("returns 413 when the body exceeds the size limit", async () => {
    const res = await request(app)
      .post("/api/v1/health")
      .send({ padding: "x".repeat(20_000) });

    expect(res.status).toBe(413);
    expect(res.body.error).toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });
});
