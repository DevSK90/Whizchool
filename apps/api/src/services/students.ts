import { ApiError } from "@whizchool/shared/api";
import { sameGuardianName } from "@whizchool/shared/people";
import { normalizeLocalPhone } from "@whizchool/shared/phone";
import type { Relationship } from "../generated/prisma/client";
import type { Prisma } from "../generated/prisma/client";
import type { AuthContext } from "../auth/context";
import { issueToken } from "../auth/tokens";
import { nextNumber } from "../counters";
import { fromIsoDate } from "../dates";
import { audit } from "../audit";
import { createFirstInvoice } from "./invoices";

type Tx = Prisma.TransactionClient;

export interface GuardianInput {
  name: string;
  relationship: Relationship;
  phone: string;
  email?: string | null;
  nic?: string | null;
  occupation?: string | null;
  address?: string | null;
}

export interface NewStudentInput {
  firstName: string;
  lastName: string;
  gender: "M" | "F";
  dob: string;
  classId: string;
  address: string;
  religion?: string | null;
  medical?: { bloodGroup?: string | null; allergies?: string | null; conditions?: string | null };
  electiveSubjectIds?: string[];
  discountIds?: string[];
  /** Kept from earlier records (imports); otherwise the next number is issued. */
  admissionNo?: string;
  /** Defaults to today. */
  joinedDate?: string;
  guardian: GuardianInput;
  inviteParent?: boolean;
}

/** "Kavindu Nimesh" + "Perera" → "K. N. Perera" */
export const nameWithInitials = (firstName: string, lastName: string) =>
  `${firstName
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => `${n[0]!.toUpperCase()}.`)
    .join(" ")} ${lastName}`;

/**
 * The guardian a new student should share, if one is already on file. This is how siblings end
 * up with one parent record and one portal account:
 * - the same email (it is the parent's sign-in, so it identifies them), or
 * - the same phone *and* a compatible name, when either side has no email. A phone alone isn't
 *   enough: both parents often share one, and a mistyped number must not link a stranger.
 */
export async function findMatchingGuardian(tx: Pick<Tx, "guardian">, input: { name: string; email?: string | null; phone: string }) {
  const email = input.email?.trim().toLowerCase() || null;
  const phone = normalizeLocalPhone(input.phone) ?? input.phone.trim();
  if (email) {
    const byEmail = await tx.guardian.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
    if (byEmail) return byEmail;
  }
  const samePhone = await tx.guardian.findMany({ where: { phone, ...(email ? { OR: [{ email: null }, { email: "" }] } : {}) }, orderBy: { id: "asc" } });
  return samePhone.find((g) => sameGuardianName(g.name, input.name)) ?? null;
}

/** Guardians on file with this phone but a different name: worth pointing out before an import. */
export async function othersWithPhone(tx: Pick<Tx, "guardian">, input: { name: string; phone: string }) {
  const phone = normalizeLocalPhone(input.phone) ?? input.phone.trim();
  return (await tx.guardian.findMany({ where: { phone } })).filter((g) => !sameGuardianName(g.name, input.name));
}

/** Next admission number: a gap-free counter that starts after the highest number already used. */
async function nextAdmissionNo(tx: Tx) {
  const counter = await tx.counter.findUnique({ where: { key: "admissionNo" } });
  let start = 1;
  if (!counter) {
    const [row] = await tx.$queryRaw<{ max: number | null }[]>`
      SELECT MAX("admissionNo"::int) AS max FROM "Student" WHERE "admissionNo" ~ '^[0-9]{1,9}$'`;
    start = (row?.max ?? 0) + 1;
  }
  return String(await nextNumber(tx, "admissionNo", start));
}

/**
 * Gives the guardian a parent-portal account, or links the account they already have.
 * Returns the invite token when a new invitation needs emailing.
 */
export async function ensureParentAccount(tx: Tx, guardian: { id: string; name: string; email: string | null; phone: string; userId: string | null }) {
  if (!guardian.email || guardian.userId) return null;
  const existing = await tx.user.findUnique({ where: { email: guardian.email.toLowerCase() } });
  if (existing) {
    if (existing.kind !== "parent") return null; // a staff member's email; they can be linked by hand
    const linkedElsewhere = await tx.guardian.findUnique({ where: { userId: existing.id } });
    if (!linkedElsewhere) await tx.guardian.update({ where: { id: guardian.id }, data: { userId: existing.id } });
    return null;
  }
  const user = await tx.user.create({
    data: {
      name: guardian.name,
      email: guardian.email.toLowerCase(),
      phone: guardian.phone,
      kind: "parent",
      status: "invited",
      invitedAt: new Date(),
      roles: { create: [{ roleId: "role_parent" }] },
    },
  });
  await tx.guardian.update({ where: { id: guardian.id }, data: { userId: user.id } });
  const token = await issueToken(tx, user.id, "invite");
  return { user, token };
}

/**
 * Creates a student with their guardian (new or matched), this year's enrolment and, for new
 * admissions, the first invoice. Run inside a transaction; email the returned invite after commit.
 */
export async function createStudent(tx: Tx, auth: AuthContext | null, input: NewStudentInput, opts: { firstInvoice: boolean; today: string }) {
  const cls = await tx.classSection.findUnique({ where: { id: input.classId }, include: { year: true, grade: true } });
  const school = await tx.school.findUniqueOrThrow({ where: { id: "school" }, select: { currentYearId: true } });
  if (!cls || cls.yearId !== school.currentYearId) throw new ApiError(422, "validation", "Choose a class from this year.", { classId: "Choose a class" });

  if (input.admissionNo && (await tx.student.findUnique({ where: { admissionNo: input.admissionNo }, select: { id: true } }))) {
    throw new ApiError(409, "duplicate", `Admission no. ${input.admissionNo} already exists.`, { admissionNo: "Already exists" });
  }
  const admissionNo = input.admissionNo || (await nextAdmissionNo(tx));

  const g = input.guardian;
  const matched = await findMatchingGuardian(tx, g);
  const guardian =
    matched ??
    (await tx.guardian.create({
      data: {
        name: g.name,
        relationship: g.relationship,
        phone: normalizeLocalPhone(g.phone) ?? g.phone,
        email: g.email?.trim().toLowerCase() || null,
        nic: g.nic || null,
        occupation: g.occupation || null,
        address: g.address || input.address || null,
      },
    }));

  const classSubjects = await tx.classSubject.findMany({ where: { classId: cls.id }, select: { subjectId: true } });
  const offered = new Set(classSubjects.map((s) => s.subjectId));
  const electives = [...new Set(input.electiveSubjectIds ?? [])].filter((id) => offered.has(id));
  const discountIds = [...new Set(input.discountIds ?? [])];
  if (discountIds.length && (await tx.discount.count({ where: { id: { in: discountIds } } })) !== discountIds.length) {
    throw new ApiError(422, "validation", "Choose discounts from the list.", { discountIds: "Unknown discount" });
  }

  const student = await tx.student.create({
    data: {
      admissionNo,
      firstName: input.firstName,
      lastName: input.lastName,
      nameWithInitials: nameWithInitials(input.firstName, input.lastName),
      gender: input.gender,
      dob: fromIsoDate(input.dob),
      classId: cls.id,
      gradeId: cls.gradeId,
      status: "active",
      joinedDate: fromIsoDate(input.joinedDate || opts.today),
      address: input.address,
      religion: input.religion || null,
      bloodGroup: input.medical?.bloodGroup || null,
      allergies: input.medical?.allergies || null,
      conditions: input.medical?.conditions || null,
      guardians: { create: [{ guardianId: guardian.id, isPrimary: true, position: 0 }] },
      enrollments: { create: [{ yearId: cls.yearId, classId: cls.id }] },
      subjects: { create: electives.map((subjectId) => ({ subjectId })) },
      discounts: { create: discountIds.map((discountId) => ({ discountId })) },
    },
  });
  if (opts.firstInvoice) await createFirstInvoice(tx, student, cls.yearId, discountIds, opts.today);
  const invite = input.inviteParent ? await ensureParentAccount(tx, guardian) : null;
  await audit(tx, auth, {
    action: "student.create",
    entity: "Student",
    entityId: student.id,
    summary: `Enrolled ${student.firstName} ${student.lastName} (${admissionNo}) in ${cls.name}${matched ? `; linked existing guardian ${guardian.name}` : ""}`,
  });
  return { student, guardian, guardianMatched: !!matched, invite, className: cls.name };
}
