/**
 * The primary output: one email PER PLATFORM every DIGEST_EVERY_HOURS, only when that platform has
 * new drafted opportunities. Each block = WHERE (community + link), WHY (triage), WHAT (ready-to-paste reply).
 * Marks drafts emailedAt so nothing is sent twice. You post by hand; nothing here writes to a platform.
 */
import { and, isNull, eq, inArray, desc } from "drizzle-orm";
import { ensureDisclosure, mentionsZeus } from "../compliance/disclosure.js";
import { db, schema } from "../db/client.js";
import { audit } from "../db/helpers.js";
import { env } from "../env.js";
import { child } from "../log.js";
import { sendMail } from "./email.js";
const log = child("digest");

const PLATFORMS = ["reddit"] as const;
const NAME: Record<string, string> = { reddit: "Reddit" };

export async function sendDigests(): Promise<number> {
  let sent = 0;
  for (const p of PLATFORMS) {
    const rows = await db().select({ d: schema.drafts, i: schema.items }).from(schema.drafts)
      .innerJoin(schema.items, eq(schema.items.id, schema.drafts.itemId))
      .where(and(eq(schema.drafts.platform, p), isNull(schema.drafts.emailedAt), eq(schema.drafts.kind, "reply")))
      .orderBy(desc(schema.items.publishedAt)).limit(40);
    if (!rows.length) continue;
    rows.sort((a, b) => (b.i.triage?.relevance ?? 0) - (a.i.triage?.relevance ?? 0));
    const { html, text } = render(p, rows);
    const subject = `[Zeus] ${NAME[p]} — ${rows.length} post${rows.length === 1 ? "" : "s"} to write`;
    try {
      await sendMail(subject, html, text);
      await db().update(schema.drafts).set({ emailedAt: new Date() }).where(inArray(schema.drafts.id, rows.map((r) => r.d.id)));
      await audit("system", "digest.sent", undefined, { platform: p, count: rows.length });
      sent++;
    } catch (err) { log.error({ p, err: String(err) }, "digest send failed"); }
  }
  return sent;
}

function render(p: string, rows: Array<{ d: typeof schema.drafts.$inferSelect; i: typeof schema.items.$inferSelect }>) {
  const e = env();
  const blocksHtml = rows.map((r, n) => {
    const t = r.i.triage!; const reply = ensureDisclosure(r.d.text, mentionsZeus(r.d.text));
    const age = Math.round((Date.now() - r.i.publishedAt.getTime()) / 36e5);
    return `
<div style="border:1px solid #ddd;border-radius:8px;padding:14px;margin:0 0 18px">
  <div style="font-size:12px;color:#666">#${n + 1} · <b>${esc(r.i.container)}</b> · ${age}h ago · relevance <b>${t.relevance}</b> · ${t.intent} · risk ${t.promotionRisk} · ${t.zeusIsTheAnswer ? "✅ mention Zeus" : "🚫 no Zeus"}</div>
  <div style="margin:6px 0"><a href="${r.i.url}">${esc(r.i.title ?? r.i.url)}</a></div>
  <div style="font-size:13px;color:#333;white-space:pre-wrap;border-left:3px solid #ccc;padding-left:8px;margin:8px 0">${esc((r.i.body ?? "").slice(0, 600))}</div>
  <div style="font-size:12px;color:#666"><i>${esc(t.reason)}</i></div>
  <div style="margin-top:10px;font-size:12px;color:#666">Paste this:</div>
  <pre style="background:#f6f6f6;padding:10px;border-radius:6px;white-space:pre-wrap;font-family:inherit">${esc(reply)}</pre>
</div>`;
  }).join("");
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:720px">
<h2 style="margin:0 0 4px">${NAME[p]} — ${rows.length} to write</h2>
<div style="font-size:12px;color:#666;margin-bottom:16px">Post by hand from your own account. Skip anything that feels off. Never more than a handful a day per community. Sandbox note: ${esc(e.SANDBOX_LABEL)}</div>
${blocksHtml}</div>`;
  const text = rows.map((r, n) => `#${n + 1} ${r.i.container} — ${r.i.url}\n${r.i.title ?? ""}\n\n${ensureDisclosure(r.d.text, mentionsZeus(r.d.text))}\n\n---`).join("\n");
  return { html, text };
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
