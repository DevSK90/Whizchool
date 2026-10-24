import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";

export const MIN_PASSWORD = 8;

export const passwordSchema = z
  .string({ error: `Use at least ${MIN_PASSWORD} characters.` })
  .min(MIN_PASSWORD, `Use at least ${MIN_PASSWORD} characters.`)
  .max(200, "Use at most 200 characters.");

/** argon2id with the library's defaults (OWASP-recommended parameters). */
export const hashPassword = (password: string) => hash(password);

// Verifying against a real hash when the email is unknown keeps response times the same,
// so sign-in timing can't reveal which emails have accounts.
let dummyHash: Promise<string> | undefined;

export async function verifyPassword(passwordHash: string | null | undefined, password: string) {
  if (!passwordHash) {
    dummyHash ??= hash("not-a-real-password");
    await verify(await dummyHash, password).catch(() => false);
    return false;
  }
  return verify(passwordHash, password).catch(() => false);
}
