import type { Db } from "./db";

/** The built-in Admin role: full access, can't be edited, and at least one active user must hold it. */
export const ADMIN_ROLE_ID = "role_admin";

/** Built-in roles in the order the roles screen lists them. */
export const SYSTEM_ROLE_ORDER = ["role_admin", "role_principal", "role_class_teacher", "role_subject_teacher", "role_accountant", "role_parent"];

type Tx = Pick<Db, "user">;

/** Active users holding the Admin role, optionally ignoring one user (the one being changed). */
export function countActiveAdmins(tx: Tx, exceptUserId?: string) {
  return tx.user.count({
    where: { status: "active", roles: { some: { roleId: ADMIN_ROLE_ID } }, ...(exceptUserId ? { id: { not: exceptUserId } } : {}) },
  });
}
