import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { SessionUser } from "@whizchool/shared/types";
import { errorHandler } from "../src/http/errors";
import { defineRoute, mountRoutes } from "../src/http/route";

const teacher: SessionUser = {
  id: "u1",
  name: "T",
  email: "t@x.lk",
  kind: "staff",
  roles: [],
  permissions: ["students.view"],
  classIds: [],
  classSubjectIds: [],
  studentIds: [],
};

/** A tiny app with test routes; `x-test-session: 1` stands in for a signed-in teacher. */
function appWith(routes: Parameters<typeof mountRoutes>[1]) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (req.get("x-test-session")) res.locals.auth = { sessionId: null, session: teacher, fullScope: new Set(), subjectClassIds: [] };
    next();
  });
  const router = express.Router();
  mountRoutes(router, routes);
  app.use(router);
  app.use(errorHandler);
  return app;
}

const app = appWith([
  defineRoute({
    method: "GET",
    path: "/items",
    access: { permission: "students.view" },
    summary: "list",
    query: z.object({ page: z.coerce.number().int().min(1).default(1) }),
    handler: ({ query }) => ({ page: query.page }),
  }),
  defineRoute({
    method: "POST",
    path: "/items",
    access: { permission: "students.edit" },
    summary: "create",
    handler: () => ({ ok: true }),
  }),
  defineRoute({
    method: "PUT",
    path: "/items/:id",
    access: "session",
    summary: "update",
    body: z.object({ name: z.string().trim().min(1, "Required"), guardian: z.object({ phone: z.string().min(9, "Too short") }) }),
    handler: ({ params, body }) => ({ id: params.id, name: body.name }),
  }),
  defineRoute({ method: "DELETE", path: "/items/:id", access: "session", summary: "delete", handler: () => undefined }),
]);

describe("route definitions", () => {
  it("returns 401 without a session and 403 without the permission", async () => {
    expect((await request(app).get("/items")).status).toBe(401);
    const forbidden = await request(app).post("/items").set("x-test-session", "1").send({});
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe("forbidden");
  });

  it("parses and coerces the query", async () => {
    const res = await request(app).get("/items?page=3").set("x-test-session", "1");
    expect(res.body).toEqual({ page: 3 });
    expect((await request(app).get("/items?page=0").set("x-test-session", "1")).status).toBe(422);
  });

  it("maps validation issues to dotted field errors", async () => {
    const res = await request(app).put("/items/7").set("x-test-session", "1").send({ name: " ", guardian: { phone: "1" } });
    expect(res.status).toBe(422);
    expect(res.body.error).toEqual({
      code: "validation",
      message: "Please fix the highlighted fields.",
      fields: { name: "Required", "guardian.phone": "Too short" },
    });
    const ok = await request(app).put("/items/7").set("x-test-session", "1").send({ name: " Kavindu ", guardian: { phone: "0771234567" } });
    expect(ok.body).toEqual({ id: "7", name: "Kavindu" });
  });

  it("requires JSON bodies and returns 204 for empty results", async () => {
    const form = await request(app).put("/items/7").set("x-test-session", "1").type("form").send("name=x");
    expect(form.status).toBe(415);
    expect((await request(app).delete("/items/7").set("x-test-session", "1")).status).toBe(204);
  });

  it("accepts an empty body without a content type (e.g. POST /auth/logout)", async () => {
    const res = await request(app).delete("/items/7").set("x-test-session", "1").set("Content-Length", "0");
    expect(res.status).toBe(204);
  });
});
