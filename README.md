# Whizchool

School management for Sri Lankan local-syllabus schools: admissions, student records, attendance, term-test results and report cards, fees with PayHere, and a parent portal.

- [PLAN.md](PLAN.md): product spec
- [BACKEND_PLAN.md](BACKEND_PLAN.md): API implementation plan and phases

## Repository layout

| Path | What it is |
|---|---|
| [`apps/web`](apps/web) | Next.js 16 frontend (staff app, parent portal, public pages) |
| [`apps/api`](apps/api) | Express 5 + Prisma 7 REST API under `/api/v1` |
| [`packages/shared`](packages/shared) | API types, permission keys, grading and phone rules used by both apps |
| [`packages/demo`](packages/demo) | In-browser demo API and the deterministic demo school used for seeding |

npm workspaces; Node 24 or newer.

## Getting started

Prerequisites: Node 24+, Docker Desktop.

```bash
npm install
cp apps/api/.env.example apps/api/.env
npm run db:up        # Postgres 18 on localhost:5433; Mailpit SMTP on 2525, inbox at http://localhost:8025
npm run db:migrate   # apply migrations
npm run db:seed      # load the demo school (~650 students), about 30 seconds
npm run dev          # API on :4000 and web on :3000
```

The web app talks to the in-browser demo API unless `apps/web/.env.local` sets `NEXT_PUBLIC_API_MODE=http`. Until the API covers a module (see the phases in BACKEND_PLAN.md), its screens work only in demo mode.

Demo accounts (password `demo1234`): `admin@`, `principal@`, `teacher@`, `accountant@` and `parent@whizchool.lk`.

## Everyday commands

| Command | Does |
|---|---|
| `npm run dev` | API (watch mode) and web together |
| `npm run preview` | Production build of the web app plus the API: every page opens in well under a second. Use it to click through the app; use `dev` while editing code (it compiles each page on first visit) |
| `npm run typecheck` | TypeScript across all workspaces |
| `npm run lint` | ESLint |
| `npm test` | Web unit + contract tests and API tests (needs `npm run db:up`) |
| `npm run test:e2e -w @whizchool/web` | Playwright E2E (always against the demo API, whatever `.env.local` says), using your installed Chrome |
| `npm run db:reset` | Recreate the dev database from migrations, then `npm run db:seed` |
| `npm run db:migrate` | Create/apply a migration after editing `apps/api/prisma/schema.prisma` |

CI (GitHub Actions) runs typecheck, lint, the web tests, the API tests against Postgres and the E2E suite on every push and pull request.
