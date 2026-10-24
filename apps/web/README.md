# Whizchool — web frontend

Next.js 16 (App Router, Cache Components) · React 19 · Tailwind v4 · shadcn/ui (Radix) · TanStack Query · next-intl · react-hook-form + Zod.
Part of the Whizchool monorepo; see the [root README](../../README.md) for setup and [`PLAN.md`](../../PLAN.md) for the product spec.

## Run it

From the repo root, after `npm install`:

```bash
npm run dev:web                       # http://localhost:3000
npm run lint -w @whizchool/web
npm test -w @whizchool/web            # unit + /api/v1 contract tests (demo API)
npm run test:e2e -w @whizchool/web    # Playwright, uses your installed Chrome
```

By default the app runs against the **in-browser demo API** (`@whizchool/demo`, `NEXT_PUBLIC_API_MODE=mock`).
It generates a deterministic ~650-student school for 2026 and keeps your changes in `localStorage`
(user menu → *Reset demo data* to start over).

| Role | Email | What to try |
|---|---|---|
| Admin | `admin@whizchool.lk` | Everything: admissions, settings, roles matrix, import |
| Principal | `principal@whizchool.lk` | Approve & release report cards, promotions |
| Teacher | `teacher@whizchool.lk` | Class teacher of 10-A (attendance, remarks), Maths mark sheets |
| Accountant | `accountant@whizchool.lk` | Fees, payments, receipts, defaulters |
| Parent | `parent@whizchool.lk` | Portal (mobile-first), pay October fees via the PayHere sandbox |

Password for all: `demo1234`. Public pages: `/` (landing), `/apply`, `/apply/status`.

## Structure

```
app/
  (public)/            landing, /apply, /apply/status        (SEO-indexed: / and /apply only)
  (auth)/              /login, /forgot-password, /reset-password, /invite/[token]
  (staff)/app/...      staff area — sidebar shell, desktop-first
  (portal)/portal/...  parent portal — mobile-first, bottom tab bar
components/            ui/ (shadcn), layout/, shared/ (DataTable, StatusBadge, …), feature folders
lib/
  api/client.ts        typed REST client — mock or http (/api/v1, cookie session)
  api/hooks.ts         TanStack Query hooks per endpoint
messages/en/           UI strings by namespace (si / ta to follow)
proxy.ts               redirects to /login when the session cookie is missing
tests/                 unit/, contract/ (the /api/v1 acceptance suite), e2e/ (Playwright)
```

API types, permission keys and grading rules live in [`packages/shared`](../../packages/shared); the demo API in [`packages/demo`](../../packages/demo).

## Connecting the real API

Set `NEXT_PUBLIC_API_MODE=http` in `.env.local` (see `.env.example`). The client then calls `/api/v1/*` on the same origin;
in development Next.js forwards those requests to the API on `API_PROXY_TARGET` (default `http://localhost:4000`), and in
production Caddy routes them. The API sets the httpOnly `wz_sid` session cookie that `proxy.ts` checks.

The demo API's handlers (`packages/demo/src/handlers`) and `tests/contract` define the contract the real API must meet.
`npm run test:contract:api -w @whizchool/web` runs the contract suite over HTTP against an API started with
`ENABLE_TEST_ROUTES=true` (it resets the database between files, so point that API at a scratch database).

## Conventions

- Authenticated pages are client components behind `AreaGate`; queries never run during prerender.
- Filters, sorting and pagination live in the URL (`useUrlState`).
- All UI text goes through `useTranslations` / `serverT`; message types are checked by TypeScript.
- Status is never shown by colour alone (`StatusBadge` = icon + label). Charts follow the validated palette in `--chart-*`.
