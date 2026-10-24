import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";

const app = createApp();
const ORIGIN = "http://localhost:3000";

describe("API foundation", () => {
  it("reports health, including the database", async () => {
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", db: "ok" });
  });

  it("answers unknown routes with the standard error shape", async () => {
    const res = await request(app).get("/api/v1/nope?x=1");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "not_found", message: "No route for GET /api/v1/nope" } });
  });

  it("sends security headers and hides the framework", async () => {
    const res = await request(app).get("/api/v1/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("blocks state-changing requests from other sites", async () => {
    const foreign = await request(app).post("/api/v1/nope").set("Origin", "https://evil.example").send({});
    expect(foreign.status).toBe(403);
    expect(foreign.body.error.code).toBe("bad_origin");

    const crossSite = await request(app).post("/api/v1/nope").set("Sec-Fetch-Site", "cross-site").send({});
    expect(crossSite.status).toBe(403);

    // Our own origin passes the check (and then reaches the 404 handler).
    const ours = await request(app).post("/api/v1/nope").set("Origin", ORIGIN).send({});
    expect(ours.status).toBe(404);
  });

  it("rejects malformed JSON with a 400", async () => {
    const res = await request(app).post("/api/v1/nope").set("Origin", ORIGIN).set("Content-Type", "application/json").send("{bad");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_json");
  });
});
