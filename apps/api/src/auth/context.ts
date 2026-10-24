import type { PermissionKey } from "@whizchool/shared/permissions";
import type { SessionUser } from "@whizchool/shared/types";
import type { Db } from "../db";

/** Everything the API knows about the caller. `session` is what /auth/me returns to the web app. */
export interface AuthContext {
  sessionId: string | null;
  session: SessionUser;
  /** Permissions granted by a role whose data scope is "all" (no record-level narrowing). */
  fullScope: ReadonlySet<PermissionKey>;
  /** Classes in which the user teaches at least one subject this year (own_subjects scope). */
  subjectClassIds: string[];
}

/** Builds the caller's roles, permissions and data scope fresh from the database (role changes apply at once). */
export async function loadAuthContext(db: Db, userId: string, sessionId: string | null): Promise<AuthContext | null> {
  const school = await db.school.findUnique({ where: { id: "school" }, select: { currentYearId: true } });
  const yearId = school?.currentYearId ?? undefined;
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      roles: { include: { role: true } },
      staff: {
        select: {
          classes: { where: { yearId }, select: { id: true } },
          classSubjects: { where: { class: { yearId } }, select: { id: true, classId: true } },
        },
      },
      guardian: {
        select: { students: { where: { student: { status: "active" } }, select: { studentId: true } } },
      },
    },
  });
  if (!user || user.status !== "active") return null;

  const roles = user.roles.map((ur) => ur.role);
  const permissions = [...new Set(roles.flatMap((r) => r.permissions))] as PermissionKey[];
  const fullScope = new Set(roles.filter((r) => r.scope === "all").flatMap((r) => r.permissions) as PermissionKey[]);
  const classSubjects = user.staff?.classSubjects ?? [];
  return {
    sessionId,
    session: {
      id: user.id,
      name: user.name,
      email: user.email,
      kind: user.kind,
      roles: roles.map((r) => ({ id: r.id, name: r.name, scope: r.scope })),
      permissions,
      classIds: user.staff?.classes.map((c) => c.id) ?? [],
      classSubjectIds: classSubjects.map((cs) => cs.id),
      studentIds: user.guardian?.students.map((s) => s.studentId) ?? [],
    },
    fullScope,
    subjectClassIds: [...new Set(classSubjects.map((cs) => cs.classId))],
  };
}
