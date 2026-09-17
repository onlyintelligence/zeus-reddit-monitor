import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { audit } from "../db/helpers.js";
import { env } from "../env.js";
import { child } from "../log.js";
import type { TriageResult } from "../types.js";
import { structured } from "./claude.js";
import { TRIAGE_SYSTEM } from "./prompts.js";
import { postureFor } from "./posture.js";
const log = child("triage");

const TriageZ = z.object({
  id: z.string(),
  relevance: z.number().int().min(0).max(100),
  isRealQuestion: z.boolean(),
  intent: z.enum(["seeking_middleman", "scam_report", "verify_someone", "how_to_trade_safely", "other"]),
  language: z.string(),
  zeusIsTheAnswer: z.boolean(),
  promotionRisk: z.enum(["low", "medium", "high"]),
  action: z.enum(["reply", "watch", "skip"]),
  reason: z.string(),
});
const BatchZ = z.object({ results: z.array(TriageZ) });

const CHEAP_SKIP = /\b(giveaway|airdrop|nsfw|onlyfans)\b/i;
const BATCH = 25;

/**
 * The relevance filter. Most of what the listener stores is not a question anyone needs answering,
 * so this discards the large majority of it: first with a free pre-filter (too short, obvious noise,
 * too old), then by scoring what survives. Only items marked `reply` go on to be drafted.
 * One model call per batch of <=25 items — each call is a subprocess, so batching keeps cost down.
 */
export async function triageNewItems(limit = 100): Promise<{ triaged: number; toReply: number }> {
  const e = env();
  const rows = await db().select().from(schema.items).where(eq(schema.items.status, "new")).orderBy(schema.items.seenAt).limit(limit);
  let triaged = 0, toReply = 0;

  const skipNow: string[] = []; const toModel: typeof rows = [];
  for (const it of rows) {
    const text = `${it.title ?? ""}\n\n${it.body ?? ""}`.trim();
    const ageDays = (Date.now() - it.publishedAt.getTime()) / 864e5;
    if (!text || text.length < 25 || CHEAP_SKIP.test(text) || ageDays > 10) skipNow.push(it.id); else toModel.push(it);
  }
  if (skipNow.length) {
    await db().update(schema.items).set({ status: "skipped", triagedAt: new Date(), triage: { relevance: 0, isRealQuestion: false, intent: "other", language: "und", zeusIsTheAnswer: false, promotionRisk: "high", action: "skip", reason: "pre-filter" } }).where(inArray(schema.items.id, skipNow));
    triaged += skipNow.length;
  }

  for (let i = 0; i < toModel.length; i += BATCH) {
    const batch = toModel.slice(i, i + BATCH);
    const user = batch.map((it, n) => [
      `### ITEM ${n + 1}  id=${it.id}`,
      `subreddit=${it.container} author=${it.author ?? "?"} age_days=${((Date.now() - it.publishedAt.getTime()) / 864e5).toFixed(1)}`,
      `posture: ${postureFor(it.container)}`, `url: ${it.url}`,
      `${it.title ?? ""}\n${(it.body ?? "").slice(0, 2500)}`.trim(),
    ].join("\n")).join("\n\n");
    let res: z.infer<typeof BatchZ>;
    try { res = await structured({ model: e.TRIAGE_MODEL, system: TRIAGE_SYSTEM + "\nReturn one result per ITEM, echoing its id exactly.", user, zod: BatchZ }); }
    catch (err) { log.error({ err: String(err) }, "triage batch failed"); continue; }
    for (const r of res.results) {
      const it = batch.find((b) => b.id === r.id); if (!it) continue;
      const { id: _id, ...t } = r; const result: TriageResult = t;
      const status = result.action === "reply" ? "triaged" : "skipped";
      if (result.action === "reply") toReply++;
      await db().update(schema.items).set({ status, triage: result, triagedAt: new Date() }).where(eq(schema.items.id, it.id));
      await audit("system", "triage", it.id, { action: result.action, relevance: result.relevance });
      triaged++;
    }
  }
  return { triaged, toReply };
}
