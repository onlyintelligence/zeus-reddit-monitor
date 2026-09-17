import { sql } from "drizzle-orm";
import { db, schema, rawSql } from "./client.js";
import { child } from "../log.js";
const log = child("lock");

const today = () => new Date().toISOString().slice(0, 10);

/** Atomic daily counter with cap. Returns false (and does not increment) when at cap. */
export async function tryIncrement(scope: string, cap: number, by = 1): Promise<boolean> {
  const key = `${today()}:${scope}`;
  const rows = await db().execute(sql`
    insert into counters (key, value) values (${key}, ${by})
    on conflict (key) do update set value = counters.value + ${by}
      where counters.value + ${by} <= ${cap}
    returning value`);
  return rows.length > 0;
}

export async function audit(actor: string, action: string, refId?: string, meta: Record<string, unknown> = {}) {
  await db().insert(schema.auditLog).values({ actor, action, refId, meta });
}

/**
 * Advisory lock so two scheduler ticks never run the same job concurrently.
 * pg_advisory_lock is SESSION-scoped, so lock and unlock must happen on the same connection: with a
 * pool the unlock lands on a different connection ("you don't own a lock of type ExclusiveLock"),
 * the lock leaks on the holder, and later ticks are skipped silently. Reserve one connection for
 * the whole job.
 */
export async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  const key = hash32(name);
  const conn = await rawSql().reserve();
  try {
    const [row] = await conn`select pg_try_advisory_lock(${key}) as ok`;
    if (!row?.ok) { log.warn({ name }, "lock held by another run — skipping this tick"); return undefined; }
    try { return await fn(); }
    finally { await conn`select pg_advisory_unlock(${key})`; }
  } finally {
    conn.release();
  }
}
function hash32(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }
