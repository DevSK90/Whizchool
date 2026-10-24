// Data scope: which records a caller's permissions apply to (PLAN.md §2).
// Every query that returns people or their records must go through these helpers.
import type { PermissionKey } from "@whizchool/shared/permissions";
import type { Prisma } from "../generated/prisma/client";
import type { AuthContext } from "./context";

/** True when a role with "all" scope grants the permission (no record-level narrowing). */
export const hasFullScope = (auth: AuthContext, key: PermissionKey) => auth.fullScope.has(key);

/** Classes a staff member may see records for: classes they teach in, plus their own class. */
export function scopedClassIds(auth: AuthContext) {
  return [...new Set([...auth.session.classIds, ...auth.subjectClassIds])];
}

/**
 * Prisma filter for students the caller may see under `key` (default students.view):
 * parents see their linked children, full-scope staff see everyone, other staff see
 * students in classes they teach.
 */
export function studentWhere(auth: AuthContext, key: PermissionKey = "students.view"): Prisma.StudentWhereInput {
  if (auth.session.kind === "parent") return { id: { in: auth.session.studentIds } };
  if (hasFullScope(auth, key)) return {};
  return { classId: { in: scopedClassIds(auth) } };
}

/** Prisma filter for class sections the caller may see under `key`. */
export function classWhere(auth: AuthContext, key: PermissionKey): Prisma.ClassSectionWhereInput {
  if (auth.session.kind === "parent") return { students: { some: { id: { in: auth.session.studentIds } } } };
  if (hasFullScope(auth, key)) return {};
  return { id: { in: scopedClassIds(auth) } };
}

/** In-memory check for one student whose class is already known. */
export function canSeeStudent(auth: AuthContext, student: { id: string; classId: string }, key: PermissionKey = "students.view") {
  if (auth.session.kind === "parent") return auth.session.studentIds.includes(student.id);
  return hasFullScope(auth, key) || scopedClassIds(auth).includes(student.classId);
}
