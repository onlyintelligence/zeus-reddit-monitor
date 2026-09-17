/**
 * Single long-running process with cron-scheduled jobs, or one job at a time:
 *   pnpm start                       the scheduler
 *   pnpm job:<name>                  run one job once and exit (for cron or a systemd timer)
 *   pnpm job:mark-posted <id> [url]  record that you posted a suggested reply by hand
 */
import { Cron } from "croner";
import { closeDb } from "./db/client.js";
import { withLock } from "./db/helpers.js";
import { env } from "./env.js";
import { child } from "./log.js";
import { listenReddit } from "./listeners/reddit.js";
import { triageNewItems } from "./triage/triage.js";
import { draftReplies } from "./triage/draft.js";
import { drainPublishQueue, markManualPosted } from "./publish/publisher.js";
import { purgeOldBodies } from "./publish/purge.js";
import { sendDigests } from "./digest/digest.js";
const log = child("scheduler");

const JOBS = {
  listen: async () => { const n = await listenReddit(); log.info({ reddit: n }, "listen done"); },
  triage: async () => { const t = await triageNewItems(); const d = await draftReplies(); log.info({ ...t, drafted: d }, "triage done"); },
  publish: async () => { const n = await drainPublishQueue(); log.info({ posted: n }, "publish done"); },
  digest: async () => { const n = await sendDigests(); log.info({ emails: n }, "digest done"); },
  purge: async () => { await purgeOldBodies(); },
} as const;
type JobName = keyof typeof JOBS;

const run = (name: JobName) => withLock(`job:${name}`, JOBS[name]).catch((err) => log.error({ name, err: String(err) }, "job failed"));

const once = process.argv[2];

/** Not a scheduled job: a human typing in a job id from the digest email. No lock, real exit codes. */
if (once === "mark-posted") {
  const jobId = process.argv[3];
  const url = process.argv[4];
  if (!jobId) { console.error("usage: pnpm job:mark-posted <jobId> [url]"); process.exit(2); }
  const ok = await markManualPosted(jobId, "cli", url);
  await closeDb();
  process.exit(ok ? 0 : 1);
}

if (once) {
  if (!(once in JOBS)) { console.error(`unknown job ${once}; one of ${Object.keys(JOBS).join(", ")}, mark-posted`); process.exit(2); }
  await run(once as JobName); await closeDb(); process.exit(0);
}

new Cron("*/30 * * * *", () => void run("listen"));   // every 30 min
new Cron("5,35 * * * *", () => void run("triage"));   // 5 min after listen (Agent SDK, subscription credit)
new Cron("*/10 * * * *", () => void run("publish"));  // run each draft through the gate; in manual mode this parks it for you
new Cron(`10 */${env().DIGEST_EVERY_HOURS} * * *`, () => void run("digest")); // one email every N hours
new Cron("15 3 * * *",   () => void run("purge"));    // nightly 48h purge
log.info({ postMode: env().REDDIT_POST_MODE }, "scheduler up");
