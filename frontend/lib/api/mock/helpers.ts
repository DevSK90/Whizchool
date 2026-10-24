import { ApiError } from "../client";
import type { PermissionKey } from "@/lib/permissions";
import type {
  ClassSection,
  Invoice,
  InvoiceListItem,
  Paginated,
  SessionUser,
  Student,
  StudentListItem,
} from "../types";
import { nextId, type DB, type MockUser } from "./db";

export interface Ctx {
  db: DB;
  params: Record<string, string>;
  query: Record<string, string>;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  now: Date;
  user: MockUser | null;
  session: SessionUser | null;
}

export const fail = (status: number, code: string, message: string, fields?: Record<string, string>): never => {
  throw new ApiError(status, code, message, fields);
};

export function isoNow(ctx: Ctx) {
  return ctx.now.toISOString();
}

export function todayISO(ctx: Ctx) {
  const d = ctx.now;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---------- session & permissions ----------

export function buildSession(db: DB, user: MockUser): SessionUser {
  const roles = user.roleIds.map((id) => db.roles.get(id)).filter((r) => !!r);
  const permissions = [...new Set(roles.flatMap((r) => r.permissions))];
  const currentYear = db.school.currentYearId;
  const classIds = user.staffId
    ? db.classes.rows.filter((c) => c.yearId === currentYear && c.classTeacherId === user.staffId).map((c) => c.id)
    : [];
  const classSubjectIds = user.staffId
    ? db.classSubjects.rows.filter((cs) => cs.teacherId === user.staffId).map((cs) => cs.id)
    : [];
  const studentIds = user.guardianId
    ? db.students.rows.filter((s) => s.guardianIds.includes(user.guardianId!) && s.status === "active").map((s) => s.id)
    : [];
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    kind: user.kind,
    roles: roles.map((r) => ({ id: r.id, name: r.name, scope: r.scope })),
    permissions,
    classIds,
    classSubjectIds,
    studentIds,
  };
}

export function requireAuth(ctx: Ctx): SessionUser {
  if (!ctx.session) fail(401, "unauthenticated", "Your session has expired. Please sign in again.");
  return ctx.session!;
}

export function requirePerm(ctx: Ctx, key: PermissionKey): SessionUser {
  const s = requireAuth(ctx);
  if (!s.permissions.includes(key)) fail(403, "forbidden", "You don't have permission to do that.");
  return s;
}

/** True when the user's roles grant `key` with an unrestricted ("all") scope. */
export function hasFullScope(s: SessionUser, key: PermissionKey, db: DB) {
  return s.roles.some((r) => r.scope === "all" && db.roles.get(r.id)?.permissions.includes(key));
}

export function canSeeStudent(ctx: Ctx, studentId: string) {
  const s = requireAuth(ctx);
  if (s.kind === "parent") return s.studentIds.includes(studentId);
  if (hasFullScope(s, "students.view", ctx.db)) return true;
  const student = ctx.db.students.get(studentId);
  if (!student) return false;
  if (s.classIds.includes(student.classId)) return true;
  return s.classSubjectIds.some((id) => ctx.db.classSubjects.get(id)?.classId === student.classId);
}

export function assertStudentAccess(ctx: Ctx, studentId: string) {
  if (!ctx.db.students.get(studentId)) fail(404, "not_found", "Student not found.");
  if (!canSeeStudent(ctx, studentId)) fail(403, "forbidden", "You can only view your own students.");
}

export function audit(ctx: Ctx, action: string, entity: string, summary: string, entityId?: string) {
  ctx.db.audit.rows.unshift({
    id: nextId(ctx.db, "aud"),
    at: isoNow(ctx),
    actor: ctx.session?.name ?? "Public",
    action,
    entity,
    entityId,
    summary,
  });
}

// ---------- lookups ----------

export function fullName(s: Pick<Student, "firstName" | "lastName">) {
  return `${s.firstName} ${s.lastName}`;
}

export function className(db: DB, classId: string | undefined) {
  return db.classes.get(classId)?.name ?? "—";
}

export function currentClasses(db: DB): ClassSection[] {
  return db.classes.rows.filter((c) => c.yearId === db.school.currentYearId);
}

export function studentBalance(db: DB, studentId: string) {
  return db.invoices.rows
    .filter((i) => i.studentId === studentId && i.status !== "void")
    .reduce((a, i) => a + i.balance, 0);
}

export function toStudentListItem(db: DB, s: Student): StudentListItem {
  const g = db.guardians.get(s.guardianIds[0]);
  return {
    id: s.id,
    admissionNo: s.admissionNo,
    fullName: fullName(s),
    gender: s.gender,
    className: className(db, s.classId),
    classId: s.classId,
    gradeId: s.gradeId,
    status: s.status,
    primaryGuardian: g?.name,
    guardianPhone: g?.phone,
    balance: studentBalance(db, s.id),
  };
}

export function toInvoiceListItem(db: DB, inv: Invoice, today: string): InvoiceListItem {
  const s = db.students.get(inv.studentId)!;
  return {
    ...inv,
    studentName: fullName(s),
    admissionNo: s.admissionNo,
    className: className(db, s.classId),
    overdue: inv.balance > 0 && inv.status !== "void" && inv.dueDate < today,
  };
}

export function fileRef(db: DB, fileId: string | undefined) {
  const f = db.files.get(fileId);
  return f ? { id: f.id, name: f.name, size: f.size, mimeType: f.mimeType, url: f.dataUrl } : undefined;
}

export function paginate<T>(rows: T[], query: Record<string, string>): Paginated<T> {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(5, Number(query.pageSize) || 20));
  return { items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize };
}

export function matches(search: string | undefined, ...fields: (string | undefined)[]) {
  if (!search) return true;
  const q = search.toLowerCase();
  return fields.some((f) => f?.toLowerCase().includes(q));
}

export function sortRows<T>(rows: T[], sort: string | undefined, accessors: Record<string, (r: T) => string | number>) {
  if (!sort) return rows;
  const desc = sort.startsWith("-");
  const key = desc ? sort.slice(1) : sort;
  const get = accessors[key];
  if (!get) return rows;
  return [...rows].sort((a, b) => {
    const x = get(a);
    const y = get(b);
    const cmp = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return desc ? -cmp : cmp;
  });
}

export function lastSchoolDay(date: string) {
  const d = new Date(`${date}T12:00:00`);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
