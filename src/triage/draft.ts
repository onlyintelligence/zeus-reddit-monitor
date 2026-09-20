import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import { lintBannedPhrases } from "../compliance/bannedPhrases.js";
import { db, schema } from "../db/client.js";
import { audit } from "../db/helpers.js";
import { env } from "../env.js";
import { child } from "../log.js";
import { structured } from "./claude.js";
import { DRAFT_SYSTEM } from "./prompts.js";
import { postureFor } from "./posture.js";
const log = child("draft");

const DraftZ = z.object({ id: z.string(), text: z.string().min(1), mentionsZeus: z.boolean() });
const BatchZ = z.object({ drafts: z.array(DraftZ) });
const PLATFORM_LIMIT: Record<string, number> = { reddit: 1200 };
const BATCH = 10;

/** Draft replies for items triage marked `reply`, ten per call. Linter failures get one retry, then skip. */
export async function draftReplies(limit = 40): Promise<number> {
  const e = env();
  const rows = await db().select().from(schema.items).where(eq(schema.items.status, "triaged")).limit(limit);
  let made = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    let batch = rows.slice(i, i + BATCH);
    for (let attempt = 0; attempt < 2 && batch.length; attempt++) {
      const user = batch.map((it, n) => {
        const t = it.triage!; const wantZeus = t.zeusIsTheAnswer && t.promotionRisk !== "high";
        return [
          `### ITEM ${n + 1}  id=${it.id}`,
          `platform=${it.platform} (limit ${PLATFORM_LIMIT[it.platform] ?? 800} chars) community=${it.container} language=${t.language} intent=${t.intent}`,
          `posture: ${postureFor(it.container)}`,
          `mentionsZeus=${wantZeus}` + (wantZeus ? ` identityPage=${e.IDENTITY_PAGE_URL}` : " (do NOT mention Zeus)"),
          `THEIR POST:\n${it.title ?? ""}\n${(it.body ?? "").slice(0, 3000)}`.trim(),
        ].join("\n");
      }).join("\n\n");
      const retryNote = attempt ? "\nA previous attempt tripped the banned-phrase linter. Avoid: escrow (as self-description), guarantee, trustless, risk-free, no middlemen, can't be scammed." : "";
      let res: z.infer<typeof BatchZ>;
      try { res = await structured({ model: e.DRAFT_MODEL, system: DRAFT_SYSTEM + "\nReturn one draft per ITEM, echoing its id exactly." + retryNote, user, zod: BatchZ, effort: "medium" }); }
      catch (err) { log.error({ err: String(err) }, "draft batch failed"); break; }
      const failed: typeof batch = [];
      for (const d of res.drafts) {
        const it = batch.find((b) => b.id === d.id); if (!it) continue;
        if (lintBannedPhrases(d.text).length) { failed.push(it); continue; }
        await db().insert(schema.drafts).values({ itemId: it.id, platform: it.platform, kind: "reply", text: d.text, model: e.DRAFT_MODEL });
        await db().update(schema.items).set({ status: "drafted" }).where(eq(schema.items.id, it.id));
        await audit("system", "draft", it.id, { mentionsZeus: d.mentionsZeus });
        made++;
      }
      batch = failed;
    }
    if (batch.length) await db().update(schema.items).set({ status: "skipped" }).where(inArray(schema.items.id, batch.map((b) => b.id)));
  }
  return made;
}
