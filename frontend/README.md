# Whizchool — web frontend

Next.js 16 (App Router, Cache Components) · React 19 · Tailwind v4 · shadcn/ui (Radix) · TanStack Query · next-intl · react-hook-form + Zod.
See [`../PLAN.md`](../PLAN.md) for the product spec.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
npm run build && npm start
npm run lint
```

Until the Express API exists the app runs against an **in-browser mock backend** (`NEXT_PUBLIC_API_MODE=mock`, the default).
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
  api/types.ts         domain types (→ packages/shared with the backend)
  api/mock/            mock backend: seed, route handlers (= the REST contract for Express)
  permissions.ts       permission catalog (module.action) + data scopes
  grading.ts           A/B/C/S/W bands, averages, competition ranking
messages/en/           UI strings by namespace (si / ta to follow)
proxy.ts               redirects to /login when the session cookie is missing
```

## Connecting the real API

Set `NEXT_PUBLIC_API_MODE=http` (see `.env.example`). The client then calls `/api/v1/*` on the same origin with
`credentials: "include"`; the Express API sets the httpOnly `wz_sid` session cookie that `proxy.ts` checks.
Every endpoint the UI uses is implemented in `lib/api/mock/handlers/*` — use them as the contract,
including permission and data-scope checks, validation errors (`422` + `fields`) and status codes.

## Conventions

- Authenticated pages are client components behind `AreaGate`; queries never run during prerender.
- Filters, sorting and pagination live in the URL (`useUrlState`).
- All UI text goes through `useTranslations` / `serverT`; message types are checked by TypeScript.
- Status is never shown by colour alone (`StatusBadge` = icon + label). Charts follow the validated palette in `--chart-*`.
