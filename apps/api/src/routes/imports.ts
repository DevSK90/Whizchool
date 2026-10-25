import { z } from "zod";
import { ApiError } from "@whizchool/shared/api";
import { sameGuardianName } from "@whizchool/shared/people";
import { checkImportRow, IMPORT_LIMITS } from "@whizchool/shared/student-import";
import type { ImportPreview, ImportRow } from "@whizchool/shared/types";
import { audit } from "../audit";
import { schoolToday } from "../dates";
import { prisma } from "../db";
import { sendEmail } from "../email/mailer";
import { inviteEmail } from "../email/templates";
import { logger } from "../logger";
import { defineRoute } from "../http/route";
import { currentYearId, schoolName } from "../school";
import { createStudent, findMatchingGuardian, othersWithPhone } from "../services/students";

const cell = z.string().max(500).optional().default("");

const rowsBody = z.object({
  rows: z
    .array(
      z.object({
        admissionNo: cell,
        firstName: cell,
        lastName: cell,
        gender: cell,
        dob: cell,
        className: cell,
        guardianName: cell,
        guardianPhone: cell,
        guardianEmail: cell,
        guardianRelationship: cell,
        address: cell,
        religion: cell,
        joinedDate: cell,
      }),
    )
    .min(1, "The file has no data rows.")
    .max(IMPORT_LIMITS.rows, `Import at most ${IMPORT_LIMITS.rows.toLocaleString("en")} rows at a time.`),
});

/**
 * Checks every row: the shared rules (formats, required values) plus what needs the database —
 * the class exists this year, admission numbers are free, possible duplicates, and guardians
 * who are already on file (they'll be linked, not duplicated).
 */
async function review(rows: ImportRow[]): Promise<ImportPreview> {
  const today = schoolToday();
  const yearId = await currentYearId();
  const classes = new Map((await prisma.classSection.findMany({ where: { yearId }, select: { id: true, name: true } })).map((c) => [c.name, c.id]));
  const checked = rows.map((r, i) => ({ index: i + 1, ...checkImportRow(r, today) }));

  const admissionNos = checked.map((r) => r.data.admissionNo).filter((n): n is string => !!n);
  const taken = new Set(
    (await prisma.student.findMany({ where: { admissionNo: { in: admissionNos } }, select: { admissionNo: true } })).map((s) => s.admissionNo),
  );
  const people = checked.filter((r) => r.data.firstName && r.data.lastName && /^\d{4}-\d{2}-\d{2}$/.test(r.data.dob ?? ""));
  const existing = people.length
    ? await prisma.student.findMany({
        where: { OR: people.map((r) => ({ firstName: { equals: r.data.firstName, mode: "insensitive" as const }, lastName: { equals: r.data.lastName, mode: "insensitive" as const }, dob: new Date(`${r.data.dob}T00:00:00Z`) })) },
        select: { firstName: true, lastName: true, dob: true, admissionNo: true },
      })
    : [];
  const personKey = (first: string, last: string, dob: string) => `${first.toLowerCase()}|${last.toLowerCase()}|${dob}`;
  const onFile = new Map(existing.map((s) => [personKey(s.firstName, s.lastName, s.dob.toISOString().slice(0, 10)), s.admissionNo]));

  const seenAdmission = new Map<string, number>();
  const seenPerson = new Map<string, number>();
  for (const r of checked) {
    const d = r.data;
    if (d.className && !/^\d{1,2}$/.test(d.className) && !classes.has(d.className)) {
      r.errors.push(`No class “${d.className}” this year`);
    }
    if (d.admissionNo) {
      if (taken.has(d.admissionNo)) r.errors.push(`Admission no. ${d.admissionNo} already exists`);
      else if (seenAdmission.has(d.admissionNo)) r.errors.push(`Admission no. ${d.admissionNo} is also on row ${seenAdmission.get(d.admissionNo)}`);
      seenAdmission.set(d.admissionNo, seenAdmission.get(d.admissionNo) ?? r.index);
    }
    if (d.firstName && d.lastName && /^\d{4}-\d{2}-\d{2}$/.test(d.dob ?? "")) {
      const key = personKey(d.firstName, d.lastName, d.dob!);
      if (onFile.has(key)) r.warnings.push(`May already be enrolled as ${onFile.get(key)} (same name and date of birth)`);
      else if (seenPerson.has(key)) r.warnings.push(`Same name and date of birth as row ${seenPerson.get(key)}`);
      seenPerson.set(key, seenPerson.get(key) ?? r.index);
    }
  }
  // Guardians already on file are linked rather than created; say so, so siblings aren't a surprise.
  for (const r of checked) {
    if (r.errors.length || !r.data.guardianPhone) continue;
    const guardian = { name: r.data.guardianName, email: r.data.guardianEmail, phone: r.data.guardianPhone };
    const g = await findMatchingGuardian(prisma, guardian);
    if (g) {
      r.warnings.push(`Guardian matches ${g.name} (${g.phone}), who is already on file; the student will be linked to them`);
      if (r.data.guardianEmail && !sameGuardianName(g.name, r.data.guardianName)) {
        r.warnings.push(`The email belongs to ${g.name}, not ${r.data.guardianName}; check it's the right parent`);
      }
    } else {
      const others = await othersWithPhone(prisma, guardian);
      if (others.length) r.warnings.push(`${others[0]!.name} also uses ${r.data.guardianPhone}; ${r.data.guardianName} will be added as a separate guardian`);
    }
  }
  return {
    rows: checked.map(({ index, data, errors, warnings }) => ({ index, data, errors, warnings })),
    valid: checked.filter((r) => !r.errors.length).length,
    invalid: checked.filter((r) => r.errors.length).length,
  };
}

export const importRoutes = [
  defineRoute({
    method: "POST",
    path: "/imports/students/preview",
    access: { permission: "import.create" },
    summary: "Check rows from a student file without saving anything",
    body: rowsBody,
    handler: ({ body }) => review(body.rows),
  }),
  defineRoute({
    method: "POST",
    path: "/imports/students/commit",
    access: { permission: "import.create" },
    summary: "Import the rows that pass every check, all together (all or nothing)",
    idempotent: true,
    body: rowsBody.extend({ inviteParents: z.boolean().default(false) }),
    handler: async ({ auth, body }) => {
      // Re-check on the server: the preview may be stale, and clients can't be trusted.
      const checked = await review(body.rows);
      const ready = checked.rows.filter((r) => !r.errors.length);
      if (!ready.length) throw new ApiError(422, "validation", "No rows are ready to import. Fix the errors and try again.");
      const yearId = await currentYearId();
      const classes = new Map((await prisma.classSection.findMany({ where: { yearId }, select: { id: true, name: true } })).map((c) => [c.name, c.id]));
      const today = schoolToday();
      const invites: { user: { name: string; email: string }; token: string }[] = [];
      await prisma.$transaction(
        async (tx) => {
          for (const { data } of ready) {
            const created = await createStudent(
              tx,
              auth,
              {
                admissionNo: data.admissionNo || undefined,
                firstName: data.firstName,
                lastName: data.lastName,
                gender: data.gender as "M" | "F",
                dob: data.dob,
                joinedDate: data.joinedDate || undefined,
                classId: classes.get(data.className)!,
                address: data.address || "—",
                religion: data.religion || null,
                guardian: {
                  name: data.guardianName,
                  relationship: (data.guardianRelationship || "Guardian") as "Father" | "Mother" | "Guardian",
                  phone: data.guardianPhone,
                  email: data.guardianEmail || null,
                  address: data.address || null,
                },
                inviteParent: body.inviteParents,
              },
              // Existing students were admitted long ago: no admission fee or first invoice.
              { firstInvoice: false, today },
            );
            if (created.invite) invites.push(created.invite);
          }
          await audit(tx, auth, {
            action: "import.students",
            entity: "Import",
            summary: `Imported ${ready.length} students (${checked.invalid} skipped, ${invites.length} parents invited)`,
          });
        },
        { timeout: 5 * 60_000, maxWait: 10_000 },
      );
      // Emails go out after the import is saved; a slow mail server must not hold the transaction.
      if (invites.length) {
        void schoolName().then(async (school) => {
          for (const i of invites) await sendEmail(inviteEmail({ ...i.user, kind: "parent" }, school, i.token));
          logger.info({ count: invites.length }, "import invitations sent");
        });
      }
      return {
        created: ready.length,
        skipped: checked.invalid,
        invited: invites.length,
        errors: checked.rows.filter((r) => r.errors.length).map((r) => ({ index: r.index, errors: r.errors })),
      };
    },
  }),
];
