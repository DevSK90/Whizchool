import request from "supertest";
import { expect } from "vitest";
import { createApp } from "../src/app";
import { sentEmails } from "../src/email/mailer";
import { ORIGIN } from "./env";

export const app = createApp();
export const PASSWORD = "demo1234";

/** A browser-like client: keeps the session cookie and sends our Origin. */
export const client = () => request.agent(app).set("Origin", ORIGIN);

export async function signIn(email: string, password = PASSWORD) {
  const agent = client();
  const res = await agent.post("/api/v1/auth/login").send({ email, password });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return agent;
}

/** Short unique suffix so tests can create users without clashing with each other or the seed. */
export const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The token in the newest email sent to `to` (invite or reset link). */
export function tokenFromEmail(to: string) {
  const email = [...sentEmails].reverse().find((e) => e.to === to);
  expect(email, `no email sent to ${to}`).toBeDefined();
  const match = email!.text.match(/\/invite\/([\w-]+)|token=([\w%-]+)/);
  return decodeURIComponent(match![1] ?? match![2]);
}
