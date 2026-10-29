import type { PermissionKey } from "@whizchool/shared/permissions";
import type { SessionUser, UserKind } from "@whizchool/shared/types";
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

interface AuthRow {
  id: string;
  name: string;
  email: string;
  kind: UserKind;
  status: string;
  roles: { id: string; name: string; scope: SessionUser["roles"][number]["scope"]; permissions: PermissionKey[] }[];
  classIds: string[];
  classSubjects: { id: string; classId: string }[];
  studentIds: string[];
}

/**
 * Builds the caller's roles, permissions and data scope fresh from the database (role changes apply at once).
 * It runs on every request, so it is one query rather than one per relation.
 */
export async function loadAuthContext(db: Db, userId: string, sessionId: string | null): Promise<AuthContext | null> {
  const [user] = await db.$queryRaw<AuthRow[]>`
    WITH "year" AS (SELECT "currentYearId" AS "id" FROM "School" WHERE "id" = 'school')
    SELECT u."id", u."name", u."email", u."kind"::text AS "kind", u."status"::text AS "status",
      coalesce((SELECT json_agg(json_build_object('id', r."id", 'name', r."name", 'scope', r."scope", 'permissions', r."permissions") ORDER BY r."id")
        FROM "UserRole" ur JOIN "Role" r ON r."id" = ur."roleId" WHERE ur."userId" = u."id"), '[]') AS "roles",
      ARRAY(SELECT c."id" FROM "Staff" st JOIN "Class" c ON c."classTeacherId" = st."id"
        WHERE st."userId" = u."id" AND c."yearId" = (SELECT "id" FROM "year") ORDER BY c."id") AS "classIds",
      coalesce((SELECT json_agg(json_build_object('id', cs."id", 'classId', cs."classId") ORDER BY cs."id")
        FROM "Staff" st JOIN "ClassSubject" cs ON cs."teacherId" = st."id" JOIN "Class" c ON c."id" = cs."classId"
        WHERE st."userId" = u."id" AND c."yearId" = (SELECT "id" FROM "year")), '[]') AS "classSubjects",
      ARRAY(SELECT sg."studentId" FROM "Guardian" g JOIN "StudentGuardian" sg ON sg."guardianId" = g."id" JOIN "Student" s ON s."id" = sg."studentId"
        WHERE g."userId" = u."id" AND s."status" = 'active' ORDER BY sg."studentId") AS "studentIds"
    FROM "User" u WHERE u."id" = ${userId}`;
  if (!user || user.status !== "active") return null;

  const permissions = [...new Set(user.roles.flatMap((r) => r.permissions))];
  const fullScope = new Set(user.roles.filter((r) => r.scope === "all").flatMap((r) => r.permissions));
  return {
    sessionId,
    session: {
      id: user.id,
      name: user.name,
      email: user.email,
      kind: user.kind,
      roles: user.roles.map((r) => ({ id: r.id, name: r.name, scope: r.scope })),
      permissions,
      classIds: user.classIds,
      classSubjectIds: user.classSubjects.map((cs) => cs.id),
      studentIds: user.studentIds,
    },
    fullScope,
    subjectClassIds: [...new Set(user.classSubjects.map((cs) => cs.classId))],
  };
}
