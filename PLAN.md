# Whizchool: v1 Product Spec (interview outcome)

## Context
Whizchool is a school management web app for a **private Sri Lankan school on the local syllabus** (Grades 1–13 including A/L streams, ~500–1,500 students). It will later be resold to other schools. The user and Claude ran a 40-question interview to remove guesswork before planning implementation. This file is the agreed spec. The next step, once approved, is a phased implementation plan; no code has been written yet.

Repo today: `frontend/` (Next.js 16.4.3 scaffold, own `.git`) and `backend/` (Express 5.3 `package.json` only).

---

## 1. Product & scope
- **Customer:** one school now, built for resale. Every school-specific rule (branding, grade bands, terms, fee types, report-card text) is a setting, never hard-coded.
- **Must-fix pains:** (1) results and report cards, (2) fee collection, (3) admissions and student records.
- **v1.0 (target in 3–6 months, roughly Feb–Apr 2027):** admissions, student/guardian records, class allocation, attendance + SMS/email alerts, term results + report cards, fees + PayHere, parent portal, year-end promotions, class timetables.
- **v1.1:** HR + payroll (EPF/ETF/APIT) + accounting ledger, and online exams/tests (which bring student logins).
- **Out of scope for v1:** e-learning/LMS, scratch-card login, library, transport, hostel, inventory, full school website/CMS, staff 2FA, native mobile app, real-time updates, late-payment fines.
- **v2 seams to preserve:** multi-school SaaS (a single `School` + settings entity so a `schoolId` can be added later) and e-learning (reuse the subject–class–teacher mapping and the file storage).

## 2. Users, auth & permissions
- **Roles (v1.0):** Admin, Principal, Class Teacher, Subject Teacher, Accountant, Parent. Students join in v1.1.
- **Permissions:** an admin-editable **permission matrix** (custom roles, per-module view/create/edit/approve), users can hold **multiple roles**, and every check also applies a **data scope** (a subject teacher sees only their own class-subjects, a class teacher only their class, a parent only their linked children).
- **Accounts:** no public signup. An admin creates the account (or imports it by CSV), and the user receives an **email invite** to set a password. Parents and staff sign in with **email + password** and reset it by email.
- **Sessions:** a session ID in an **httpOnly cookie**, with session rows in Postgres. Revocation is instant, and deactivating a user kills their sessions.

## 3. Core user flows
1. **Visitor:** landing page → **Apply** (public form + document upload) → confirmation email with a reference number.
2. **Admissions pipeline:** New → Interview/Test → Accepted/Rejected → **Enroll**. Enrolling creates the Student, Guardian(s) and Enrollment, and sends the parent an invite.
3. **Marks → report cards:** subject teachers enter term marks out of 100 → class teacher adds remarks → principal **approves and releases** → parents see results in the portal and download a PDF, and the school can batch-print.
4. **Fees:** a monthly tuition invoice is generated automatically, alongside one-time fees (admission, deposit), ad-hoc charges (exam, trip, books) and discounts/scholarships (sibling, staff-child, merit). Parents pay through **PayHere** online, or the accountant records cash, cheque or bank-deposit payments. A receipt PDF is issued either way, and the system tracks the defaulters list and arrears carried forward.
5. **Attendance:** the class teacher marks daily attendance, and parents of absent students get an SMS. Admins can send bulk SMS/email notices by grade, class or role.
6. **Year end:** the admin opens a new academic year, the system proposes a bulk promotion (+1 grade; Grade 11 → left/A/L intake; Grade 13 → graduated), the admin adjusts repeaters and sections, then confirms. Class history is kept.
7. **Parent (returning, mobile):** dashboard with a child switcher showing attendance, latest results, fee balance with a pay button, and notices.
9. **Timetables:** staff drag subjects onto a Monday–Friday board covering the school day (07:30–13:30 by default, a setting), one board per class per academic year, as one weekly pattern repeating all year. Save keeps a draft; publishing shows it to the class's teachers and parents. A teacher or room clash with another class is flagged as you drag and blocks publishing. Teachers get "My timetable" and a "today's classes" card; parents get a Timetable tab per child, with only that child's O/L electives.
8. **Data onboarding:** **CSV/Excel import** of existing students, guardians and classes, with a validation preview and an error report.

## 4. Pages & routing (Next.js App Router)
- **Public:** `/`, `/apply`, `/apply/status`, `/login`, `/forgot-password`, `/reset-password`, `/invite/[token]`. Only `/` and `/apply` are SEO-indexed; everything else is `noindex`.
- **Staff (`/app/...`, desktop-first):** dashboard, admissions, students `[id]`, staff (list, `[id]`, add and edit), classes, timetables (overview, `[classId]` builder, my timetable), attendance, exams/marks, report cards, fees (invoices, payments, structures, defaulters), messaging, settings (school, academic years, terms, grades/sections/streams, subjects, grade bands, fee types), users & roles (permission matrix), import, audit log.
- **Parent portal (`/portal/...`, mobile-first):** home, child `[id]` (timetable, attendance, results, report-card PDFs, fees/pay), notices, profile.
- Route protection uses an auth check in Next middleware (redirect only). **Every permission is enforced in Express.**

## 5. UI
- shadcn/ui + Tailwind v4, with **light and dark** themes via tokens. Staff screens are desktop-first (and usable on tablets); parent screens are mobile-first.
- **i18n-ready from day one** (all UI text through translation keys), launching in **English**. Sinhala and Tamil come later, along with Unicode fonts for the PDFs.
- Standard patterns: data tables with server-side pagination, sorting and filtering (state in the URL), skeleton loaders, explicit empty states, confirm dialogs for destructive actions, and inline form errors.

## 6. Data model (Postgres + Prisma)
**Settings/academics:** School (singleton, with settings JSON + branding), AcademicYear, Term (3 per year), Grade (1–13), Stream (A/L), Section/Class (grade + section + year + class teacher), Subject, ClassSubject (class × subject × teacher), GradeBand (A 75–100, B 65–74, C 50–64, S 35–49, W 0–34, editable).
**People:** User (email unique, status), Role, Permission, UserRole (with an optional scope), Session, Invite; Staff (the employment record of every academic and non-academic staff member: employee no., title, name, job title, type, phone, email, gender, date of birth, NIC, address, join date, qualifications, emergency contact, notes, leaving date and reason; a login, the linked User, is optional); Student (admission no. unique, status: active/left/graduated/expelled, leaving date); Guardian (linked to a User); StudentGuardian (many-to-many, relationship, primary-contact flag); Enrollment (student × class × year, class history); StudentSubject (O/L electives and A/L stream subjects).
**Admissions:** Application (reference no. unique, stage, data), ApplicationDocument.
**Timetables:** ClassTimetable (one per class: revision, published revision, who and when), TimetableBlock (class, draft or published, day 1–5, start and end minutes, lesson/interval/activity, class subject, label, room). Teacher and subject come live through ClassSubject. School holds the day's start and end.
**Curriculum (national, in `packages/shared/src/curriculum.ts`):** O/L: English, Mathematics, Science and History for all, one first language, one religion, and one subject from each of Baskets I–III. A/L: six streams (Physical Science, Biological Science, Commerce, Arts, Engineering Technology, Bio Systems Technology), each with compulsory subjects and options (one, or any three in Commerce and Arts), plus General English and the Common General Test for everyone; subjects carry the Department of Examinations' numbers. A class offers the subjects the school chooses; ClassSubject.optionGroup says whether everyone takes one or students choose it. Students' choices are StudentSubject rows. Subject has a teacher list (SubjectTeacher); a class's teacher for a subject comes from it.
**Attendance:** AttendanceRecord (student × date unique; status present/absent/late/excused).
**Exams:** Exam (term test per term/grade), Mark (student × exam × subject unique; 0–100 or AB for absent), ReportCard (status draft → approved → released; remarks; computed totals/averages/rank snapshot; PDF file).
**Fees:** FeeType (recurrence: monthly/one-time/ad-hoc), FeeStructure (grade × fee type × amount × year), Discount and StudentDiscount, Invoice + InvoiceLine, Payment (method, reference, PayHere order ID unique), PaymentAllocation, Receipt.
**Platform:** FileObject (S3 key, mime type, size, owner), Notification/MessageLog (SMS/email, status), Notice, AuditLog (actor, entity, before/after), EventLog.
**v1.1 (designed now, built later):** StaffContract, SalaryStructure, PayrollRun, Payslip, LeaveRequest, LedgerAccount, JournalEntry, QuestionBank, Question, OnlineExam, ExamAttempt.
**Deletion rules:** archive, never hard-delete. Marks, invoices and payments are immutable once approved/posted, and corrections are made as reversal/adjustment entries with an audit trail. Only drafts and mistakes may be hard-deleted, and only by an admin.

## 7. Architecture
- **Monorepo, npm workspaces:** `apps/web` (Next.js), `apps/api` (Express, TypeScript), `packages/shared` (Zod schemas, types, permission keys, grade logic).
- **Express owns everything server-side:** business logic, Prisma, auth/sessions, RBAC + data scope, PayHere webhook, file signing, and jobs. REST under `/api/v1`, with Zod-validated input and a consistent error shape.
- **Next.js is UI-only:** TanStack Query with a typed API client, optimistic updates for marks/attendance grids, polling (no websockets). Both apps sit behind one domain via a Caddy reverse proxy (`/api` → Express), so cookies are first-party.
- **Background jobs: pg-boss** (Postgres-backed) handles monthly invoice generation (cron, 1st of month), bulk SMS/email, batch report-card PDFs and import processing, with retries and idempotency keys.
- **PDFs:** `@react-pdf/renderer` (ASSUMPTION, lighter than Puppeteer on a small VPS).

## 8. External services (and what each owns)
| Service | Owns |
|---|---|
| PostgreSQL (self-hosted in Docker) | All data, sessions, job queue |
| S3-compatible storage (e.g. Cloudflare R2), private buckets | Photos, admission documents, report cards, receipt PDFs (served via short-lived signed URLs; local-disk adapter in dev) |
| PayHere Checkout API | Online card/wallet payments; `notify_url` webhook verified by md5sig and idempotent on order ID |
| Notify.lk | SMS (absence alerts, notices), behind an adapter interface |
| Resend | Transactional email (invites, resets, application receipts, notices), behind an adapter interface |
| Sentry (free tier) | Frontend and backend errors |
| UptimeRobot | Uptime pings + email alert |

## 9. Security, edge cases, ops
- **Security baseline:**
  - Permission and data-scope checks on every route
  - Zod validation and CSRF protection
  - helmet
  - argon2/bcrypt password hashing
  - Rate limits on login, reset and apply
  - Secrets in environment variables only; uploads limited by mime type and size
  - PayHere checksum verification
  - Audit log
  - Encrypted nightly off-server database backups
  - Basic alignment with Sri Lanka's Personal Data Protection Act (PDPA)
- **Edge cases:**
  - Double submits: idempotency keys on payments and imports, disabled buttons
  - Expired session: redirect to login, preserving the return URL
  - PayHere outage: offline payment still works; a pending order expires later
  - SMS failure: logged and retried, with failures visible in the message log
  - Marks locked after approval
  - Rank ties: shared rank
- **Observability:** Sentry, pino JSON logs, uptime alerts, and an EventLog for key events (payment received, report released, SMS failed, import done).
- **Environments:** local (Docker Postgres), plus staging and production on **one VPS with Docker Compose + Caddy**, each with its own database. **GitHub Actions** runs lint, typecheck and tests on every PR, and deploys on a tag.
- **Done for v1.0:**
  - Unit tests for fee/discount/arrears math and grading/rank logic
  - API integration tests for permissions and data scope
  - Playwright E2E tests for apply → enroll, marks → approve → parent sees the report, invoice → PayHere sandbox → receipt, and attendance → SMS
  - Two weeks of school UAT on staging, ending in sign-off

## 10. Verified current versions (npm, 2026-10-24)
next 16.4.3 (read `node_modules/next/dist/docs/` before coding, per `frontend/AGENTS.md`) · express 5.3.0 · @prisma/client **7.10.x** (the prisma 8 line is still RC, so use 7 stable) · zod 4.6 · @tanstack/react-query 5.104 · pg-boss 12.38 · tailwindcss 4.3 · shadcn 4.22 · next-intl 4.14 · resend 6.34 · @sentry/node 11.9 · pino 10.4 · vitest 5.0 · @playwright/test 1.64

---

## ASSUMPTIONS (not firmly stated by the user)
1. Currency is LKR and the timezone Asia/Colombo. The academic year is Jan–Dec by default, with configurable start/end dates and 3 terms.
2. One parent account sees all linked children (sibling linking via StudentGuardian).
3. Subjects a student doesn't take are excluded from their totals, and "AB" (absent) counts as 0 for the average but is shown as AB.
4. Monthly invoices are generated on the 1st, payments are applied to the oldest invoice first, and partial payments are allowed.
5. Sessions expire after 7 days of inactivity for parents and 12 hours for staff.
6. Uploads are capped at 5 MB, as images (JPG/PNG/WebP) or PDF.
7. No product analytics in v1; the EventLog only.
8. Supported browsers are the last 2 versions of Chrome, Edge, Safari and Firefox, plus Android Chrome. Targets: p95 API < 300 ms, LCP < 2.5 s on 4G.
9. PDFs use @react-pdf/renderer.
10. The PayHere merchant account and Notify.lk sender ID belong to the school, in its name.
11. The permission matrix ships with default system roles that can't be deleted.

## OPEN RISKS / unknowns
1. **Parents without email:** with email-only login and invites, parents who have no email (or rarely check it) can't use the portal. Possible mitigation: add a mobile + SMS OTP option later.
2. **Scope vs. capacity:** v1.0 for one developer in 3–6 months is achievable but tight, because the editable permission matrix + data scoping adds about 1–2 weeks. v1.1 (payroll + accounting + online exams) is roughly another 2–3 months.
3. **Payroll compliance (v1.1):** EPF, ETF and APIT rules and tax tables change, so they need verification against current Inland Revenue Department (IRD) and Labour Department rules before building.
4. **PayHere onboarding:** this requires business registration documents and approval, which can take weeks, so it should start early. Fees and settlement times are unverified.
5. **Notify.lk sender ID approval** and SMS cost per message are unverified, and the SMS budget is unknown.
6. **School-specific report-card layout** (fields, signatures, ranking rules, conduct/remarks sections) is still to be collected from the school.
7. **Data quality of the existing records** for CSV import is unknown (format, duplicates, missing guardian emails).
8. **Single VPS** is a single point of failure. Backups must be tested by actually restoring them.
9. **Repo restructure:** moving the existing `frontend/.git` into a root monorepo needs care to keep history.

## Next step
On approval: turn this spec into a phased implementation plan (Phase 0 foundation → v1.0 modules → v1.1), starting with the monorepo restructure, Prisma schema, auth/RBAC and settings.
