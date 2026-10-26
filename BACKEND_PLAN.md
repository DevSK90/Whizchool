# Whizchool: backend implementation plan

Companion to [PLAN.md](PLAN.md), which holds the product spec. This file covers how the API gets built. Written 2026-10-24, after the frontend v1.0 was completed against a mock API.

## 1. Starting point

**The frontend already defines most of the backend.**

- The mock API in `frontend/lib/api/mock/` implements **115 endpoints** across 11 areas: auth, school settings, students, admissions, attendance, exams and report cards, fees and PayHere, messages, admin, dashboards and files.
- Request and response shapes are typed in `lib/api/types.ts`.
- The conventions the backend must keep:
  - lists return `{ items, total, page, pageSize }`;
  - errors return `{ error: { code, message, fields } }`;
  - the session cookie is `wz_sid`, which `proxy.ts` checks before rendering protected pages.
- The contract tests in `tests/contract/` pin down behaviour: who gets 401 or 403, field errors, idempotency, oldest-invoice-first payment allocation, locked marks and rank ties.

So the backend is mostly **"make the contract tests pass against a real server"**, not open-ended design.

### Decisions that differ from PLAN.md

| PLAN.md | Decision for v1 | Why |
|---|---|---|
| Server PDFs with `@react-pdf/renderer` | Keep the browser print views for report cards and receipts ("Save as PDF") | Already built and verified. Server PDFs (about +1 week) are only needed for emailing PDFs. |
| CSV/Excel import | CSV only, parsed in the browser and sent as JSON rows | Add Excel later if the school's data needs it. |
| "Admin opens a new academic year" | The next year is created when promotions are confirmed | One step fewer for the admin. |
| Grades, streams and sections editable | Grades and streams are fixed seed data; sections are classes | The Sri Lankan grade structure is fixed. |
| (not covered) | Retire the mock API once the real API covers every module; a seeded demo database replaces it | Avoids maintaining two backends. |

### Demo-only mock behaviour that must not reach production

- Invite and reset links returned in API responses. The real API only emails them; the links are returned only when the email adapter is the dev one.
- `/payhere/sandbox/:id/complete`. This becomes a dev-only "fake PayHere" provider, enabled by an environment flag, that calls the real webhook handler with a valid signature.

## 2. Architecture

### Repository layout (npm workspaces)

| Path | Contents |
|---|---|
| `apps/web` | The Next.js frontend (moved from `frontend/`, keeping git history) |
| `apps/api` | Express 5 + TypeScript |
| `packages/shared` | API types, permission keys, grading, phone helpers and Zod input schemas, used by both apps |
| `packages/demo` | The mock API and the deterministic demo-school generator. The web app uses it in mock mode; the API seed script uses the generator. |

### Stack and conventions

- **Runtime:** Node 24, ESM, `tsx` in dev and a bundled build for production.
- **Database:** Prisma 7 with the `@prisma/adapter-pg` driver adapter and `prisma.config.ts`.
- **Validation and logging:** Zod 4 and pino.
- **Route definitions:** each route is declared once with its method, path, permission, data scope, input schema and handler. That single list drives three things:
  - enforcement, so no route can skip its permission check;
  - a generated test that calls every route as every role and checks the 401/403 results;
  - an OpenAPI document later, if wanted.
- **Data scope in one module:** helpers such as `studentWhere(session)` return the Prisma filter for each scope:
  - `all`: everything;
  - `own_class`: the class teacher's classes;
  - `own_subjects`: the subject teacher's class-subjects;
  - `own_children`: a parent's linked children.

  Every query goes through them. This is the most security-critical code and gets the most tests.
- **IDs:**
  - text primary keys with a UUIDv7 default;
  - the seed keeps readable IDs (`cls_2026_10a`, `exam_2026_3`) so the E2E tests keep working;
  - human-facing numbers (admission no., `APP-2026-0001`, invoice and receipt numbers) come from a counter table, incremented in the same transaction, so receipts have no gaps.
- **Money and dates:**
  - money is `Decimal(12,2)` in the database and a number in the API;
  - attendance dates, due dates and dates of birth are Postgres `date` values;
  - "today" is computed in Asia/Colombo time.
- **Immutability:**
  - marks lock on submit;
  - invoices and payments are voided or reversed with a reason, never edited;
  - every change writes an audit row in the same transaction.
- **Jobs:** pg-boss handles monthly invoices, SMS and email sending, PayHere order expiry and session cleanup.
- **Files:** a storage adapter, local disk in dev and S3/R2 in production. Files are served through short-lived signed URLs.

## 3. Security

- **Sessions:**
  - a random 32-byte token in an httpOnly, Secure, `SameSite=Lax` cookie named `wz_sid`;
  - only its SHA-256 hash is stored;
  - sessions slide: 12 hours of inactivity for staff, 7 days for parents;
  - deactivating a user or changing their password deletes their sessions.
- **Passwords:** argon2id via `@node-rs/argon2` (prebuilt binaries).
- **CSRF:** `SameSite=Lax` plus an Origin / `Sec-Fetch-Site` check on every unsafe method, and JSON-only bodies. The PayHere webhook is exempt and verified by its signature instead.
- **Rate limits:** login, forgot password, apply, uploads and the status lookup. An in-memory store is enough on one server.
- **Forgot password** returns the same response whether or not the email exists.
- **Uploads:**
  - 5 MB limit;
  - the file type is checked from the file's bytes, not its name;
  - photos are resized and EXIF data is stripped with `sharp`, so children's photos never keep GPS data;
  - storage is private and files are served only through signed URLs.
- **Idempotency:**
  - an `idempotency_keys` table stores the key, user, route, request hash and response for 24 hours;
  - a replayed key returns the stored response;
  - the same key with a different body returns 409.
- **PayHere:**
  - the server computes the checkout hash;
  - the notify webhook verifies `md5sig` and is idempotent on the order ID;
  - the return URL is never trusted. Only the verified webhook marks an order paid, and the frontend already polls for that.

## 4. Testing

1. **One contract suite, two targets.** `tests/contract/helpers.ts` gets a transport switch: the mock (as now) or HTTP against the real API. The same suite then shows when the real API matches what the UI expects.
2. **API integration tests:** vitest + supertest against a real Postgres test database, reset per file. They cover the permission and data-scope matrix (generated from the route list), money math, rank ties, promotions and the PayHere signature.
3. **Unit tests:** grading, fee and discount math, and payment allocation.
4. **E2E:** the Playwright suite runs with the frontend in `http` mode against the seeded API.
5. **CI:** GitHub Actions runs lint, typecheck, unit tests, API tests (with a Postgres service container) and E2E on every pull request.

The mock's deterministic seed becomes the Prisma seed, so dev, E2E and sales demos all use the same demo school.

## 5. Phases

Estimates are for one developer. Each phase ends with its contract tests passing over HTTP and its screens checked in `http` mode.

| # | Phase | Scope | Est. |
|---|---|---|---|
| 0 | Foundation | • Monorepo move (keeping history), `packages/shared`, `packages/demo`<br>• Docker Compose: Postgres 18 + Mailpit<br>• API skeleton: config checked with Zod, error format, pino, route definitions, Origin check, health check<br>• Prisma schema for all v1.0 tables, plus the seed<br>• Next.js forwards `/api/v1` to Express in dev<br>• CI pipeline and the two-target contract suite | 1.5 wk |
| 1 | Auth and access | • Sessions, login/logout/me, invites, forgot/reset/change password<br>• Users and roles (the permission matrix) and data scope<br>• Audit log, rate limits, email adapter (Resend; Mailpit in dev) | 2 wk |
| 2 | School setup | • School settings and public school info<br>• Years and terms, grades, streams, classes, subjects, class-subjects<br>• Grade bands and staff | 1 wk |
| 3 | People and admissions | • Students and guardians (sibling linking), status changes<br>• File storage, photos and documents<br>• Public apply + status lookup, pipeline, enroll + invite<br>• CSV import preview/commit | 2 wk |
| 4 | Attendance and messaging | • Attendance summary/sheet/save<br>• Absence SMS via pg-boss (Notify.lk adapter; logs only in dev)<br>• Bulk SMS/email with delivery status, notices | 1.5 wk |
| 5 | Exams and report cards | • Exams, marks sheets (validate, submit and lock, unlock)<br>• Remarks, approve/release/revert, with the rank snapshot saved at approval<br>• Batch view, parent results, promotions and year rollover | 2 wk |
| 6 | Fees and PayHere | • Fee types and structures, discounts, invoices and charges<br>• Monthly invoice job (cron, idempotent per period)<br>• Payments allocated oldest-first, reversals, defaulters and reminders<br>• PayHere checkout, notify webhook, order expiry, fake provider for dev | 2.5 wk |
| 7 | Dashboards | • Staff dashboard and parent portal summaries<br>• Query tuning: indexes, p95 under 300 ms with 1,500 students | 0.5 wk |
| 8 | Production readiness | • VPS with Docker Compose + Caddy, staging and production<br>• Nightly encrypted backups **with a restore test**<br>• Sentry, uptime checks, security review, E2E on staging | 1.5 wk |

**Total: about 14–15 weeks**, ending early February 2027. Two weeks of school testing (UAT) on staging then fits inside the Feb–Apr 2027 target. If the school needs year-end promotions this December, Phase 5 moves ahead of Phase 4.

**Switching the frontend:**

- From Phase 1, local development runs the UI in `http` mode against the real API.
- Screens for modules not yet built show their error state until their phase lands.
- The mock stays for E2E and demos until the API covers everything.

## 6. Owner actions with lead times

| Action | Needed by |
|---|---|
| Apply for a PayHere merchant account in the school's name. Approval can take weeks; sandbox access comes sooner and is all Phase 6 needs. | Phase 6 |
| Register a Notify.lk sender ID and agree the SMS budget | Phase 4 |
| Collect the school's current report card (fields, signatures, ranking rules) | Phase 5 |
| Get an anonymised export of existing student records, to shape the importer | Phase 3 |
| Choose a VPS provider (about 2 vCPU / 4 GB RAM) and a domain | Phase 8 |

## 7. Progress

| Phase | Status | Notes |
|---|---|---|
| 0 Foundation | Done (2026-10-24) | Monorepo, schema, seed, CI, two-target contract suite |
| 1 Auth and access | Done (2026-10-24) | Sessions, invites, password reset/change, users, roles, audit log, data-scope helpers, rate limits, email (Mailpit/Resend) |
| 2 School setup | Done (2026-10-24) | School profile, years and terms (saved and validated as a set), streams, subjects, grade bands, staff list, classes (default subjects, one class per class teacher, A/L stream required), class detail scoped to the classes a teacher teaches |
| 3 People and admissions | Done (2026-10-25) | Students (list, profile, admit, edit, status), guardians (sibling matching by email, or phone plus name), real uploads (type from bytes, EXIF stripped, signed links), admissions pipeline and enrolment, CSV import with header matching, idempotency keys |
| 4 Attendance and messaging | Done (2026-10-26) | Attendance summary, sheet and save (no future dates, weekends or dates outside the year); absence SMS only for today's register and only for newly absent students, withdrawn if corrected before sending; bulk SMS/email with reachable/unreachable counts and SMS part counting (Sinhala/Tamil at 67 characters a part, at most 3 parts); notices; pg-boss queue with a delivery outbox (claimed rows, retries, sweeper), nightly cleanup |

**Contract coverage over HTTP:** `auth`, `admin`, `school`, `students`, `admissions`, `import`, `comms`. The list lives in `apps/web/vitest.config.ts` (`API_CONTRACTS`); add each area's file as its phase lands. `academics` joins in Phase 5. Contract and API tests pin "today" to Friday 2026-10-23 (`POST /test/clock`), so date rules don't depend on the day the tests run.

**Carried forward:**

- **Invites and resets aren't queued.** They still send inline (5-second SMTP timeout, failures logged to the EventLog), because a queued job would keep the secret link in the job table. The application confirmation email and every bulk message go through the queue.
- **Notify.lk sender ID.** Real SMS needs the school's approved sender ID in School settings and `NOTIFYLK_USER_ID`/`NOTIFYLK_API_KEY` in the environment. Until then, production would send under an unapproved ID and Notify.lk refuses it (the deliveries show as failed).
- **SMS sending hours.** Bulk SMS goes out as soon as it's sent. If the school wants quiet hours (e.g. nothing after 8 pm), the queue can hold messages until morning.
- **Email retries.** Every email failure counts as retryable (3 tries per recipient, then failed). With Resend, a permanent refusal (bad address) should fail at once; sort this out when the Resend adapter gets a real domain.
- **Idempotency keys.** In place (routes opt in with `idempotent: true`); payments use them in Phase 6. The nightly cleanup removes keys older than a day.
- **Object storage (Phase 8).** Files are on local disk (`apps/api/storage`); production needs the S3/R2 adapter behind the same interface.
- **Sibling discount.** No longer applied automatically when a guardian is matched; staff choose discounts. If the school wants it automatic, it should be a school setting.
- **Production bootstrap (Phase 8).** Production can't use the demo seed, so it needs a one-off command that creates the school, the built-in roles and the first admin (who then receives an invite).
- **Grade bands and released results (Phase 5).** Changing the grading scale re-grades results that are computed live. Approval must freeze the grade letters with the rank snapshot, so released report cards never change.
- **Teachers on the classes page (UI).** Teachers see every class card but can open only their own (others show "You don't have access"). Filtering the cards to their classes would be tidier.
- **Faster contract resets.** Each contract file re-seeds the demo school over HTTP (about 30 s). The API tests already clone a template database; the reset route can do the same once the suite grows.
