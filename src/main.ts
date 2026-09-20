/**
 * Entry point. Either a single job (`pnpm job:listen`) or a long-running
 * scheduler (`pnpm start`) that runs the same jobs on a cron.
 *
 * The jobs, and what each one touches:
 *
 *   listen   reads public Reddit RSS  -> writes `items`
 *   triage   scores items, drafts replies for the useful ones -> writes `drafts`
 *   digest   emails the drafts to the operator -> marks `drafts.emailed_at`
 *   purge    clears stored post text older than PURGE_AFTER_HOURS
 *
 * None of them writes to Reddit. The publish loop is registered ONLY when
 * REDDIT_POST_MODE is "api", and even then this repository contains no code
 * that creates a publish job for it to drain — see src/publish/gate.ts.
 */
import { Cron } from "croner";
import { closeDb } from "./db/client.js";
import { withLock } from "./db/helpers.js";
import { env } from "./env.js";
import { child } from "./log.js";
import { listenReddit } from "./listeners/reddit.js";
import { loadPosture } from "./triage/posture.js";
import { triageNewItems } from "./triage/triage.js";
import { draftReplies } from "./triage/draft.js";
import { sendDigests } from "./digest/digest.js";
import { purgeOldBodies } from "./publish/purge.js";
import { drainPublishQueue, markManualPosted } from "./publish/gate.js";

const log = child("main");

const JOBS = {
  listen: async () => {
    const n = await listenReddit();
    log.info({ reddit: n }, "listen done");
  },
  triage: async () => {
    await loadPosture();
    const t = await triageNewItems();
    const d = await draftReplies();
    log.info({ ...t, drafted: d }, "triage done");
  },
  digest: async () => {
    const n = await sendDigests();
    log.info({ emails: n }, "digest done");
  },
  purge: async () => {
    await purgeOldBodies();
  },
  publish: async () => {
    const n = await drainPublishQueue();
    log.info({ posted: n }, "publish done");
  },
  /** `pnpm job:mark-posted <jobId> [url]` — closes a manual_pending job after a human posted it. */
  "mark-posted": async () => {
    const [, , , jobId, url] = process.argv;
    if (!jobId) {
      console.error("usage: pnpm job:mark-posted <jobId> [url]");
      process.exit(2);
    }
    await markManualPosted(jobId, "cli", url);
    log.info({ jobId, url }, "marked posted");
  },
} as const;
type JobName = keyof typeof JOBS;

const run = (name: JobName) =>
  withLock(`job:${name}`, JOBS[name]).catch((err) => log.error({ name, err: String(err) }, "job failed"));

const once = process.argv[2] as JobName | undefined;
if (once) {
  if (!(once in JOBS)) {
    console.error(`unknown job ${once}; one of ${Object.keys(JOBS).join(", ")}`);
    process.exit(2);
  }
  await run(once);
  await closeDb();
  process.exit(0);
}

const e = env();
await loadPosture();
new Cron("*/30 * * * *", () => void run("listen"));
new Cron("5,35 * * * *", () => void run("triage"));
new Cron(`10 */${e.DIGEST_EVERY_HOURS} * * *`, () => void run("digest"));
new Cron("15 3 * * *", () => void run("purge"));

// Registered only in api mode. In the default "manual" mode there is no publish
// loop at all, so nothing in this process can reach Reddit's write endpoints.
if (e.REDDIT_POST_MODE === "api") {
  log.warn("REDDIT_POST_MODE=api — the publish loop is registered; this requires approved Reddit Data API access");
  new Cron("*/10 * * * *", () => void run("publish"));
}

log.info({ mode: e.REDDIT_POST_MODE, subreddits: e.REDDIT_SUBREDDITS.length }, "scheduler up");
