import type { Db } from "./db";

type Tx = Pick<Db, "$queryRaw">;

/**
 * Next value of a gap-free sequence (receipt, invoice, admission and employee numbers).
 * Atomic under concurrency; run it inside the transaction that uses the number so a rollback
 * gives the number back. `start` is the value used when the sequence doesn't exist yet.
 */
export async function nextNumber(tx: Tx, key: string, start: number): Promise<number> {
  const [row] = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "Counter" ("key", "value") VALUES (${key}, ${start})
    ON CONFLICT ("key") DO UPDATE SET "value" = "Counter"."value" + 1
    RETURNING "value"`;
  return row.value;
}

/** Reserves `count` consecutive values of a sequence at once; returns the first. */
export async function reserveNumbers(tx: Tx, key: string, count: number, start: number): Promise<number> {
  const [row] = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "Counter" ("key", "value") VALUES (${key}, ${start + count - 1})
    ON CONFLICT ("key") DO UPDATE SET "value" = "Counter"."value" + ${count}
    RETURNING "value"`;
  return row.value - count + 1;
}
