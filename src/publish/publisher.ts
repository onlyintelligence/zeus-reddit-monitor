/**
 * The only code path that could write to Reddit. Every drafted reply passes through it, in order:
 *   1. banned-phrase linter (hard fail, no override)
 *   2. disclosure injection
 *   3. daily cap and a minimum gap between replies
 *   4. in manual mode: park the job for a human. In api mode: the Reddit API call.
 * Nothing upstream can skip 1–3. That is the point of having a single gate.
 *
 * In the default manual mode step 4 never contacts Reddit at all: the job is parked as
 * `manual_pending`, the digest email hands you the URL and the text, and you post it yourself.
 */
import { and, eq, lte } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { audit, tryIncrement, withLock } from "../db/helpers.js";
import { env } from "../env.js";
import { child } from "../log.js";
import { lintBannedPhrases } from "../compliance/bannedPhrases.js";
import { ensureDisclosure, mentionsZeus } from "../compliance/disclosure.js";
import { redditComment } from "./reddit.js";
const log = child("publisher");

/**
 * Minimum time between two replies. This sits far inside Reddit's published rate limit — it is not
 * calibrated against one. The point is the shape of the activity rather than its volume: a person
 * who answers a question, goes away, and comes back later, rather than a feed emptying a queue as
 * fast as it is allowed to. REDDIT_MAX_REPLIES_PER_DAY does the same job over a longer window.
 */
const MIN_GAP_MS = 25 * 60_000;
let lastPostAt = 0;

export async function drainPublishQueue(): Promise<number> {
  return (await withLock("publish", async () => {
    const e = env();
    const jobs = await db().select().from(schema.publishJobs)
      .where(and(eq(schema.publishJobs.status, "queued"), lte(schema.publishJobs.notBefore, new Date())))
      .orderBy(schema.publishJobs.createdAt).limit(10);
    let done = 0;
    for (const job of jobs) {
      const [draft] = await db().select().from(schema.drafts).where(eq(schema.drafts.id, job.draftId));
      if (!draft) continue;
      const item = draft.itemId ? (await db().select().from(schema.items).where(eq(schema.items.id, draft.itemId)))[0] : undefined;
      if (!item) { await fail(job.id, "source item is gone; nothing to reply to"); continue; }

      // 1. linter — hard fail
      const hits = lintBannedPhrases(draft.text);
      if (hits.length) { await fail(job.id, `linter: ${hits.map((h) => h.why).join("; ")}`); await audit("system", "publish.blocked", job.id, { hits }); continue; }

      // 2. compliance injection
      const text = ensureDisclosure(draft.text, mentionsZeus(draft.text));

      // 3. stay well inside Reddit's limits, and spaced out like a person
      if (Date.now() - lastPostAt < MIN_GAP_MS) continue;
      if (!(await tryIncrement("reddit:reply", e.REDDIT_MAX_REPLIES_PER_DAY))) { log.info("daily reply cap reached; deferring"); await defer(job.id, 6 * 3600_000); continue; }

      // 4a. manual mode (the default): hand back to the human, do not touch Reddit.
      if (e.REDDIT_POST_MODE === "manual") {
        await db().update(schema.publishJobs).set({ status: "manual_pending" }).where(eq(schema.publishJobs.id, job.id));
        await audit("system", "publish.manual_pending", job.id, { url: item.url });
        continue;
      }

      // 4b. api mode: requires approved Data API access and a registered script app.
      await db().update(schema.publishJobs).set({ status: "posting", attempts: job.attempts + 1 }).where(eq(schema.publishJobs.id, job.id));
      try {
        const res = await redditComment(item.externalId, text);
        await db().update(schema.publishJobs).set({ status: "posted", postedAt: new Date(), externalResultId: res.id, externalResultUrl: res.url ?? null }).where(eq(schema.publishJobs.id, job.id));
        await db().update(schema.items).set({ status: "posted" }).where(eq(schema.items.id, item.id));
        lastPostAt = Date.now();
        await audit("system", "publish.posted", job.id, { url: res.url });
        done++;
      } catch (err) {
        log.error({ job: job.id, err: String(err) }, "publish failed");
        if (job.attempts + 1 >= 3) await fail(job.id, String(err)); else await defer(job.id, 30 * 60_000, String(err));
      }
    }
    return done;
  })) ?? 0;
}

const fail = (id: string, err: string) => db().update(schema.publishJobs).set({ status: "failed", lastError: err }).where(eq(schema.publishJobs.id, id));
const defer = (id: string, ms: number, err?: string) => db().update(schema.publishJobs).set({ notBefore: new Date(Date.now() + ms), lastError: err }).where(eq(schema.publishJobs.id, id));

/**
 * Human confirms they posted a manual_pending job by hand: `pnpm job:mark-posted <jobId> [url]`.
 * Also moves the source item to `posted`, which is what makes it exempt from the 48h purge — and,
 * conversely, what makes everything we did not reply to eligible for it.
 * Returns false (and logs) for an unknown job id rather than reporting a silent success.
 */
export async function markManualPosted(jobId: string, actor: string, url?: string): Promise<boolean> {
  const [job] = await db().update(schema.publishJobs)
    .set({ status: "posted", postedAt: new Date(), externalResultUrl: url ?? null })
    .where(eq(schema.publishJobs.id, jobId))
    .returning({ draftId: schema.publishJobs.draftId });
  if (!job) { log.error({ job: jobId }, "no such publish job"); return false; }
  const [draft] = await db().select({ itemId: schema.drafts.itemId }).from(schema.drafts).where(eq(schema.drafts.id, job.draftId));
  if (draft?.itemId) await db().update(schema.items).set({ status: "posted" }).where(eq(schema.items.id, draft.itemId));
  await audit(actor, "publish.manual_posted", jobId, { url });
  return true;
}
