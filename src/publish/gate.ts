/**
 * The publish gate — every check that stands between an approved draft and Reddit.
 *
 * ─── READ THIS BEFORE THE CODE ────────────────────────────────────────────────
 *
 * In this repository the gate is UNREACHABLE, and that is checkable rather than
 * asserted: nothing here inserts a row into `publish_jobs`. Grep for
 * `insert(schema.publishJobs` and you will find nothing. In the wider internal
 * tool those rows are created by a separate approval step that is not part of
 * this repository, so `drainPublishQueue()` always finds an empty queue.
 *
 * It is kept, rather than deleted, because it is the honest answer to "what
 * would this program do if it were allowed to post?" — and because deleting it
 * would leave the caps, the linter and the manual-mode branch undocumented in
 * the one repository that exists to be read.
 *
 * ─── THE ORDER OF THE CHECKS IS THE GUARANTEE ─────────────────────────────────
 *
 *   1. claim linter          hard fail; cannot be overridden by the approval step
 *   2. disclosure            appended automatically when the reply mentions the product
 *   3. daily cap + spacing   REDDIT_MAX_REPLIES_PER_DAY, and a minimum gap
 *   4. manual mode           REDDIT_POST_MODE=manual (the default) hands back to a human
 *   5. api mode              only reachable with approved Reddit Data API access
 *
 * A job that reaches step 4 in the default mode becomes `manual_pending` and the
 * function returns without touching Reddit. That branch is the product claim in
 * the README, and it is four lines below.
 */
import { and, eq, lte } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { audit, tryIncrement, withLock } from "../db/helpers.js";
import { env } from "../env.js";
import { child } from "../log.js";
import { lintBannedPhrases } from "../compliance/bannedPhrases.js";
import { ensureDisclosure, mentionsZeus } from "../compliance/disclosure.js";
import { redditComment } from "./reddit.js";

const log = child("gate");

/**
 * Minimum spacing between replies. This keeps activity comfortably inside
 * Reddit's published rate limits. It is a floor, not a target: a burst of
 * candidates cannot become a burst of replies, and most days the relevance
 * filter produces far fewer candidates than this allows anyway.
 */
const MIN_GAP_MS = 25 * 60_000;
let lastPostAt = 0;

async function fail(jobId: string, error: string) {
  await db().update(schema.publishJobs).set({ status: "failed", lastError: error }).where(eq(schema.publishJobs.id, jobId));
}

async function defer(jobId: string, ms: number, error?: string) {
  await db().update(schema.publishJobs)
    .set({ notBefore: new Date(Date.now() + ms), ...(error ? { lastError: error } : {}) })
    .where(eq(schema.publishJobs.id, jobId));
}

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

      // 1. claim linter — hard fail, not overridable from the approval step
      const hits = lintBannedPhrases(draft.text);
      if (hits.length) {
        await fail(job.id, `linter: ${hits.map((h) => h.why).join("; ")}`);
        await audit("system", "publish.blocked", job.id, { hits });
        continue;
      }

      // 2. disclosure, appended by the program rather than trusted to the draft
      const text = ensureDisclosure(draft.text, mentionsZeus(draft.text));

      // 3. daily ceiling and spacing
      if (Date.now() - lastPostAt < MIN_GAP_MS) continue;
      if (!(await tryIncrement("reddit:reply", e.REDDIT_MAX_REPLIES_PER_DAY))) {
        log.info("daily cap reached; deferring");
        await defer(job.id, 6 * 3600_000);
        continue;
      }

      // 4. MANUAL MODE — the default. Hand back to the human; do not touch Reddit.
      if (e.REDDIT_POST_MODE === "manual") {
        await db().update(schema.publishJobs).set({ status: "manual_pending" }).where(eq(schema.publishJobs.id, job.id));
        await audit("system", "publish.manual_pending", job.id, { url: item?.url });
        continue;
      }

      // 5. api mode — requires approved Reddit Data API access and the credentials
      //    in REDDIT_CLIENT_ID / SECRET / USERNAME / PASSWORD.
      await db().update(schema.publishJobs).set({ status: "posting", attempts: job.attempts + 1 }).where(eq(schema.publishJobs.id, job.id));
      try {
        if (!item?.externalId) throw new Error("no externalId to reply to");
        const res = await redditComment(item.externalId, text);
        await db().update(schema.publishJobs)
          .set({ status: "posted", postedAt: new Date(), externalResultId: res.id, externalResultUrl: res.url ?? null })
          .where(eq(schema.publishJobs.id, job.id));
        await db().update(schema.items).set({ status: "posted" }).where(eq(schema.items.id, item.id));
        lastPostAt = Date.now();
        await audit("system", "publish.posted", job.id, { url: res.url });
        done++;
      } catch (err) {
        log.error({ job: job.id, err: String(err) }, "publish failed");
        if (job.attempts + 1 >= 3) await fail(job.id, String(err));
        else await defer(job.id, 30 * 60_000, String(err));
      }
    }
    return done;
  })) ?? 0;
}

/** A human confirms they posted a `manual_pending` job by hand. */
export async function markManualPosted(jobId: string, actor: string, url?: string) {
  await db().update(schema.publishJobs)
    .set({ status: "posted", postedAt: new Date(), externalResultUrl: url ?? null })
    .where(eq(schema.publishJobs.id, jobId));
  await audit(actor, "publish.manual_posted", jobId, { url });
}
