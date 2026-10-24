import type { StudentListItem } from "@whizchool/shared/types";
import type { Db } from "./db";
import type { Prisma } from "./generated/prisma/client";

export const fullName = (s: { firstName: string; lastName: string }) => `${s.firstName} ${s.lastName}`;

export const studentListInclude = {
  class: { select: { name: true } },
  guardians: { orderBy: { position: "asc" }, take: 1, include: { guardian: { select: { name: true, phone: true } } } },
} satisfies Prisma.StudentInclude;

type StudentListRow = Prisma.StudentGetPayload<{ include: typeof studentListInclude }>;

/** Outstanding fees per student: unpaid amounts on invoices that aren't void. */
export async function balances(db: Pick<Db, "invoice">, studentIds: string[]) {
  if (!studentIds.length) return new Map<string, number>();
  const rows = await db.invoice.groupBy({
    by: ["studentId"],
    where: { studentId: { in: studentIds }, status: { not: "void" } },
    _sum: { total: true, paid: true },
  });
  return new Map(rows.map((r) => [r.studentId, Number(r._sum.total ?? 0) - Number(r._sum.paid ?? 0)]));
}

/**
 * Rows for student tables. Fee balances are included only when the caller may see fees;
 * otherwise they are reported as 0, so they never reach screens that hide them.
 */
export async function toStudentListItems(db: Pick<Db, "invoice">, students: StudentListRow[], opts: { withBalance: boolean }) {
  const owed = opts.withBalance ? await balances(db, students.map((s) => s.id)) : new Map<string, number>();
  return students.map((s): StudentListItem => {
    const g = s.guardians[0]?.guardian;
    return {
      id: s.id,
      admissionNo: s.admissionNo,
      fullName: fullName(s),
      gender: s.gender,
      className: s.class.name,
      classId: s.classId,
      gradeId: s.gradeId,
      status: s.status,
      ...(g ? { primaryGuardian: g.name, guardianPhone: g.phone } : {}),
      balance: owed.get(s.id) ?? 0,
    };
  });
}
