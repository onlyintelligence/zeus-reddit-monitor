/**
 * Reddit LISTENER — public RSS/Atom only.
 *
 * This reads the same public feeds any browser or feed reader can fetch: no API key, no OAuth, no
 * login, nothing behind a permission we have not been granted. Data API access is being requested
 * through Reddit's own process; until it is granted, this is the whole of the read path.
 *
 * Feeds used:
 *   https://www.reddit.com/r/<sub>/new.rss
 *   https://www.reddit.com/r/<sub>/search.rss?q=<kw>&restrict_sr=1&sort=new
 * They carry title, author, link, timestamp and body text. No scores, nothing private.
 *
 * Politeness is the design, not a workaround: a real User-Agent naming the operator and how to
 * reach them, one request at a time with a fixed gap between feeds, and Retry-After honoured on
 * any 429 (http() does that for every caller).
 */
import { env } from "../env.js";
import { child } from "../log.js";
import type { ListenedItem } from "../types.js";
import { fetchFeed } from "./rss.js";
import { storeItems } from "./store.js";

const log = child("listeners:reddit");
/** Ten seconds between feeds, so a listen pass is a trickle rather than a burst. new.rss alone
 *  covers normal use, so the extra per-keyword search feeds are opt-in via REDDIT_SEARCH_FEEDS
 *  rather than on by default: fewer requests for the same answer. */
const FEED_GAP_MS = 10_000;
const INTENT_QUERIES = ["middleman", "mm", "is this legit", "scammed", "vouch"];

export async function listenReddit(): Promise<number> {
  const e = env();
  let total = 0;
  for (const sub of e.REDDIT_SUBREDDITS) {
    const urls = [
      `https://www.reddit.com/r/${sub}/new.rss?limit=50`,
      ...(e.REDDIT_SEARCH_FEEDS ? INTENT_QUERIES : []).map((q) => `https://www.reddit.com/r/${sub}/search.rss?q=${encodeURIComponent(q)}&restrict_sr=1&sort=new&t=week`),
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
      await sleep(FEED_GAP_MS);
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
