// Permission catalog shared by the UI (and later by the Express API via packages/shared).
// A permission key is `${module}.${action}`; roles hold a list of keys plus a data scope.

export const PERMISSION_ACTIONS = ["view", "create", "edit", "approve"] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export const PERMISSION_MODULES = {
  dashboard: ["view"],
  admissions: ["view", "create", "edit", "approve"],
  students: ["view", "create", "edit"],
  classes: ["view", "create", "edit"],
  timetable: ["view", "edit"],
  attendance: ["view", "create", "edit"],
  marks: ["view", "create", "edit"],
  reportCards: ["view", "edit", "approve"],
  promotions: ["view", "approve"],
  fees: ["view", "create", "edit"],
  payments: ["view", "create", "approve"],
  messaging: ["view", "create"],
  users: ["view", "create", "edit"],
  roles: ["view", "edit"],
  settings: ["view", "edit"],
  import: ["create"],
  audit: ["view"],
} as const satisfies Record<string, readonly PermissionAction[]>;

export type PermissionModule = keyof typeof PERMISSION_MODULES;

type KeysFor<M extends PermissionModule> = `${M}.${(typeof PERMISSION_MODULES)[M][number]}`;
export type PermissionKey = { [M in PermissionModule]: KeysFor<M> }[PermissionModule];

export const ALL_PERMISSIONS = (
  Object.entries(PERMISSION_MODULES) as [PermissionModule, readonly PermissionAction[]][]
).flatMap(([module, actions]) => actions.map((a) => `${module}.${a}` as PermissionKey));

/** Data scope narrows which records a role's permissions apply to. */
export type DataScope = "all" | "own_class" | "own_subjects" | "own_children";

export function hasPermission(granted: readonly string[], key: PermissionKey) {
  return granted.includes(key);
}
