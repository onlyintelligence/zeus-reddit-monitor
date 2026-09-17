/**
 * Reddit PUBLISHER — two modes.
 *   manual (default): nothing here touches Reddit. The digest email gives you the thread URL and
 *                     the drafted text; you post it yourself, from your own account, in a browser,
 *                     and then run `pnpm job:mark-posted <jobId>` to record it.
 *   api:              script-app OAuth (password grant) → oauth.reddit.com/api/comment. Requires an
 *                     approved Data API request AND an app registered at reddit.com/prefs/apps.
 * Reddit's own rate limit is reported in X-Ratelimit-* headers; our own, lower cap is
 * REDDIT_MAX_REPLIES_PER_DAY, applied in publisher.ts before anything reaches this file.
 */
import { env } from "../env.js";
import { httpJson, form } from "../http.js";
import { child } from "../log.js";
const log = child("publish:reddit");
let cached: { token: string; exp: number } | undefined;

async function redditToken() {
  const e = env();
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  if (!e.REDDIT_CLIENT_ID || !e.REDDIT_CLIENT_SECRET || !e.REDDIT_USERNAME || !e.REDDIT_PASSWORD) throw new Error("reddit api creds missing");
  const basic = Buffer.from(`${e.REDDIT_CLIENT_ID}:${e.REDDIT_CLIENT_SECRET}`).toString("base64");
  const r = await httpJson<{ access_token: string; expires_in: number }>("https://www.reddit.com/api/v1/access_token", {
    method: "POST", userAgent: e.REDDIT_USER_AGENT,
    headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
    body: form({ grant_type: "password", username: e.REDDIT_USERNAME, password: e.REDDIT_PASSWORD, scope: "submit read identity" }),
  });
  cached = { token: r.access_token, exp: Date.now() + r.expires_in * 1000 };
  return cached.token;
}

/** thingId = "t3_xxx" (post) or "t1_xxx" (comment). */
export async function redditComment(thingId: string, text: string) {
  const e = env();
  const tok = await redditToken();
  const r = await httpJson<{ json: { errors: unknown[]; data?: { things: Array<{ data: { id: string; permalink?: string } }> } } }>("https://oauth.reddit.com/api/comment", {
    method: "POST", userAgent: e.REDDIT_USER_AGENT,
    headers: { authorization: `Bearer ${tok}`, "content-type": "application/x-www-form-urlencoded" },
    body: form({ api_type: "json", thing_id: thingId, text }),
  });
  if (r.json.errors?.length) throw new Error("reddit: " + JSON.stringify(r.json.errors));
  const d = r.json.data?.things?.[0]?.data;
  log.info({ id: d?.id }, "commented");
  return { id: d?.id ?? "", url: d?.permalink ? `https://www.reddit.com${d.permalink}` : undefined };
}
