import { describe, expect, it } from "vitest";
import type { PermissionKey } from "@whizchool/shared/permissions";
import type { AuthContext } from "../src/auth/context";
import { canSeeStudent, classWhere, studentWhere } from "../src/auth/scope";

function ctx(partial: { kind?: "staff" | "parent"; full?: PermissionKey[]; classIds?: string[]; subjectClassIds?: string[]; studentIds?: string[] }): AuthContext {
  return {
    sessionId: null,
    session: {
      id: "u",
      name: "U",
      email: "u@x.lk",
      kind: partial.kind ?? "staff",
      roles: [],
      permissions: [],
      classIds: partial.classIds ?? [],
      classSubjectIds: [],
      studentIds: partial.studentIds ?? [],
    },
    fullScope: new Set(partial.full ?? []),
    subjectClassIds: partial.subjectClassIds ?? [],
  };
}

describe("data scope", () => {
  const kavindu = { id: "stu_1", classId: "cls_10a" };

  it("lets full-scope staff see every student", () => {
    const principal = ctx({ full: ["students.view"] });
    expect(studentWhere(principal)).toEqual({});
    expect(canSeeStudent(principal, kavindu)).toBe(true);
  });

  it("limits teachers to the classes they teach or lead", () => {
    const teacher = ctx({ classIds: ["cls_10a"], subjectClassIds: ["cls_10a", "cls_10b"] });
    expect(studentWhere(teacher)).toEqual({ classId: { in: ["cls_10a", "cls_10b"] } });
    expect(canSeeStudent(teacher, kavindu)).toBe(true);
    expect(canSeeStudent(teacher, { id: "stu_2", classId: "cls_1a" })).toBe(false);
    expect(classWhere(teacher, "attendance.view")).toEqual({ id: { in: ["cls_10a", "cls_10b"] } });
  });

  it("judges full scope per permission, not per user", () => {
    // Full access to fees doesn't widen what the user sees under students.view.
    const accountant = ctx({ full: ["fees.view"] });
    expect(studentWhere(accountant)).toEqual({ classId: { in: [] } });
    expect(studentWhere(accountant, "fees.view")).toEqual({});
  });

  it("limits parents to their own children, whatever else they hold", () => {
    const parent = ctx({ kind: "parent", studentIds: ["stu_1"], full: ["students.view"] });
    expect(studentWhere(parent)).toEqual({ id: { in: ["stu_1"] } });
    expect(canSeeStudent(parent, kavindu)).toBe(true);
    expect(canSeeStudent(parent, { id: "stu_9", classId: "cls_10a" })).toBe(false);
  });
});
