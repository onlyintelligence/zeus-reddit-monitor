import { sql } from "drizzle-orm";
import { db, schema } from "./client.js";

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

/** Advisory lock so two scheduler ticks never run the same job concurrently. */
export async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  const key = hash32(name);
  const rows = await db().execute(sql`select pg_try_advisory_lock(${key}) as ok`);
  const got = (rows[0] as { ok?: boolean } | undefined)?.ok;
  if (!got) return undefined;
  try { return await fn(); }
  finally { await db().execute(sql`select pg_advisory_unlock(${key})`); }
}
function hash32(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }
