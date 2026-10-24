// Wire-level contract shared by the web client, the demo API and the real API.

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type QueryParams = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  query?: QueryParams;
  body?: unknown;
  signal?: AbortSignal;
  /** Sent as Idempotency-Key so a retried request (double click, flaky network) is applied only once. */
  idempotencyKey?: string;
}

/** Error body for every non-2xx response: `{ error: { code, message, fields? } }`. */
export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }

  toBody(): ApiErrorBody {
    return { error: { code: this.code, message: this.message, ...(this.fields ? { fields: this.fields } : {}) } };
  }
}

/** Name of the session cookie; the web proxy checks for it before rendering protected pages. */
export const SESSION_COOKIE = "wz_sid";
