import { db, schema } from "../db/client.js";
import { child } from "../log.js";
import { type ListenedItem } from "../types.js";
const log = child("listeners:store");

/** Insert-if-new. Returns the number of genuinely new items. */
export async function storeItems(items: ListenedItem[]): Promise<number> {
  if (!items.length) return 0;
  const rows = items.map((i) => ({
    platform: i.platform, externalId: i.externalId, url: i.url, container: i.container,
    author: i.author, title: i.title, body: i.body.slice(0, 20_000), publishedAt: i.publishedAt, raw: i.raw ?? null,
  }));
  const inserted = await db().insert(schema.items).values(rows)
    .onConflictDoNothing({ target: [schema.items.platform, schema.items.externalId] })
    .returning({ id: schema.items.id });
  log.info({ platform: items[0].platform, fetched: items.length, inserted: inserted.length }, "stored");
  return inserted.length;
}
