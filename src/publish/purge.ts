/** Reddit Data API terms: delete removed content and routinely purge stored content within 48h. */
import { and, lt, notInArray, isNotNull } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { audit } from "../db/helpers.js";
import { env } from "../env.js";
import { child } from "../log.js";
const log = child("purge");
export async function purgeOldBodies() {
  const cutoff = new Date(Date.now() - env().PURGE_AFTER_HOURS * 3600_000);
  const rows = await db().update(schema.items)
    .set({ body: null, raw: null, status: "purged" })
    .where(and(lt(schema.items.seenAt, cutoff), isNotNull(schema.items.body), notInArray(schema.items.status, ["approved", "posted", "pending_approval", "drafted"])))
    .returning({ id: schema.items.id });
  log.info({ purged: rows.length }, "purged item bodies");
  await audit("system", "purge", undefined, { count: rows.length });
  return rows.length;
}
