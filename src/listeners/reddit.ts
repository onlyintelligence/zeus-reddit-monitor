/**
 * Reddit LISTENER — public RSS/Atom only. No API key, no OAuth, nothing to get approved.
 *
 * Why RSS and not the Data API (as of Sep 2026):
 *   - Self-service OAuth app creation is closed (Responsible Builder Policy, Nov 2025 / Jun 2026).
 *   - Unauthenticated .json endpoints return 403 since late May 2026.
 *   - Public Atom feeds still work and carry title/author/link/timestamp/full text (no scores).
 *
 * Feeds used:
 *   https://www.reddit.com/r/<sub>/new.rss
 *   https://www.reddit.com/r/<sub>/search.rss?q=<kw>&restrict_sr=1&sort=new
 *
 * Be polite: real User-Agent, ~1 req/2s, honour 429 (http() already does).
 */
import { env } from "../env.js";
import { child } from "../log.js";
import { type ListenedItem } from "../types.js";
import { fetchFeed } from "./rss.js";
import { storeItems } from "./store.js";

const log = child("listeners:reddit");
const INTENT_QUERIES = ["middleman", "mm", "is this legit", "scammed", "vouch"];

export async function listenReddit(): Promise<number> {
  const e = env();
  let total = 0;
  for (const sub of e.REDDIT_SUBREDDITS) {
    const urls = [
      `https://www.reddit.com/r/${sub}/new.rss?limit=50`,
      ...INTENT_QUERIES.map((q) => `https://www.reddit.com/r/${sub}/search.rss?q=${encodeURIComponent(q)}&restrict_sr=1&sort=new&t=week`),
    ];
    for (const url of urls) {
      try {
        const entries = await fetchFeed(url, e.REDDIT_USER_AGENT);
        const items: ListenedItem[] = entries.map((en) => ({
          platform: "reddit",
          externalId: redditFullname(en.id, en.link),
          url: en.link,
          container: sub,
          author: en.author?.replace(/^\/u\//, ""),
          title: en.title,
          body: en.content,
          publishedAt: en.isoDate ? new Date(en.isoDate) : new Date(),
        }));
        total += await storeItems(items);
      } catch (err) {
        log.warn({ url, err: String(err) }, "feed failed");
      }
      await sleep(2000);
    }
  }
  return total;
}

/** Reddit Atom ids look like "t3_1abcde"; fall back to the post id from the URL. */
function redditFullname(id: string, link: string) {
  if (/^t[1-6]_[a-z0-9]+$/i.test(id)) return id;
  const m = /\/comments\/([a-z0-9]+)\//i.exec(link);
  return m ? `t3_${m[1]}` : id;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
