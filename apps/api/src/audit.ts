import type { AuthContext } from "./auth/context";
import type { Prisma } from "./generated/prisma/client";

type AuditDb = { auditLog: { create(args: { data: Prisma.AuditLogUncheckedCreateInput }): Promise<unknown> } };

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string;
  summary: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
}

/** Records who did what. Pass the transaction client so the entry commits with the change it describes. */
export function audit(db: AuditDb, auth: AuthContext | null, entry: AuditEntry) {
  return db.auditLog.create({
    data: {
      actorId: auth?.session.id ?? null,
      actor: auth?.session.name ?? "Public",
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      summary: entry.summary,
      before: entry.before,
      after: entry.after,
    },
  });
}
