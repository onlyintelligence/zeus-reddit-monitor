/**
 * The only output: an email, every DIGEST_EVERY_HOURS, listing the posts worth answering.
 * Each block is WHERE (subreddit + link), WHY (the triage result), and WHAT (the drafted reply,
 * with the disclosure line already applied).
 *
 * It lists only replies that have cleared the publisher gate and are parked as `manual_pending` —
 * so the linter, the disclosure rule and the daily cap all apply to what you are shown, not merely
 * to some later step. Drafts marks emailedAt so nothing is sent twice. Nothing here posts anything.
 */
import { and, isNull, eq, inArray, desc } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { audit } from "../db/helpers.js";
import { env } from "../env.js";
import { child } from "../log.js";
import { ensureDisclosure, mentionsZeus } from "../compliance/disclosure.js";
import { sendMail } from "./email.js";
const log = child("digest");

export async function sendDigests(): Promise<number> {
  const rows = await db().select({ d: schema.drafts, i: schema.items, jobId: schema.publishJobs.id })
    .from(schema.drafts)
    .innerJoin(schema.items, eq(schema.items.id, schema.drafts.itemId))
    .innerJoin(schema.publishJobs, eq(schema.publishJobs.draftId, schema.drafts.id))
    .where(and(isNull(schema.drafts.emailedAt), eq(schema.publishJobs.status, "manual_pending")))
    .orderBy(desc(schema.items.publishedAt)).limit(40);
  if (!rows.length) return 0;
  rows.sort((a, b) => (b.i.triage?.relevance ?? 0) - (a.i.triage?.relevance ?? 0));

  const { html, text } = render(rows);
  const subject = `[Zeus] Reddit — ${rows.length} post${rows.length === 1 ? "" : "s"} to write`;
  try {
    await sendMail(subject, html, text);
    await db().update(schema.drafts).set({ emailedAt: new Date() }).where(inArray(schema.drafts.id, rows.map((r) => r.d.id)));
    await audit("system", "digest.sent", undefined, { count: rows.length });
    return 1;
  } catch (err) {
    log.error({ err: String(err) }, "digest send failed");
    return 0;
  }
}

type Row = { d: typeof schema.drafts.$inferSelect; i: typeof schema.items.$inferSelect; jobId: string };

function render(rows: Row[]) {
  const e = env();
  const blocksHtml = rows.map((r, n) => {
    const t = r.i.triage!; const reply = ensureDisclosure(r.d.text, mentionsZeus(r.d.text));
    const age = Math.round((Date.now() - r.i.publishedAt.getTime()) / 36e5);
    return `
<div style="border:1px solid #ddd;border-radius:8px;padding:14px;margin:0 0 18px">
  <div style="font-size:12px;color:#666">#${n + 1} · <b>r/${esc(r.i.container)}</b> · ${age}h ago · relevance <b>${t.relevance}</b> · ${t.intent} · risk ${t.promotionRisk} · ${t.zeusIsTheAnswer ? "✅ mention Zeus" : "🚫 no Zeus"}</div>
  <div style="margin:6px 0"><a href="${r.i.url}">${esc(r.i.title ?? r.i.url)}</a></div>
  <div style="font-size:13px;color:#333;white-space:pre-wrap;border-left:3px solid #ccc;padding-left:8px;margin:8px 0">${esc((r.i.body ?? "").slice(0, 600))}</div>
  <div style="font-size:12px;color:#666"><i>${esc(t.reason)}</i></div>
  <div style="margin-top:10px;font-size:12px;color:#666">Paste this:</div>
  <pre style="background:#f6f6f6;padding:10px;border-radius:6px;white-space:pre-wrap;font-family:inherit">${esc(reply)}</pre>
  <div style="font-size:12px;color:#666">Once you have posted it: <code>pnpm job:mark-posted ${esc(r.jobId)}</code></div>
</div>`;
  }).join("");
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:720px">
<h2 style="margin:0 0 4px">Reddit — ${rows.length} to write</h2>
<div style="font-size:12px;color:#666;margin-bottom:16px">Post by hand from your own account. Skip anything that feels off. Sandbox note: ${esc(e.SANDBOX_LABEL)}</div>
${blocksHtml}</div>`;
  const text = rows.map((r, n) => `#${n + 1} r/${r.i.container} — ${r.i.url}\n${r.i.title ?? ""}\n\n${ensureDisclosure(r.d.text, mentionsZeus(r.d.text))}\n\nmark posted: pnpm job:mark-posted ${r.jobId}\n---`).join("\n");
  return { html, text };
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
