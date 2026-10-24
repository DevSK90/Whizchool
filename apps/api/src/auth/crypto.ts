import { createHash, randomBytes } from "node:crypto";

/** 256-bit random token, URL-safe. Used for session cookies and invite/reset links. */
export const randomToken = () => randomBytes(32).toString("base64url");

/** Tokens are stored only as SHA-256 hashes, so a database leak doesn't expose live sessions or links. */
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
