import Parser from "rss-parser";
import { http } from "../http.js";

/** Shared Atom/RSS fetch. Reddit returns Atom; rss-parser handles both dialects. */
const parser = new Parser({
  customFields: { item: [["content", "contentHtml"], ["content:encoded", "contentEncoded"]] },
});

export interface FeedEntry {
  id: string; link: string; title?: string; author?: string; content: string; isoDate?: string;
}

export async function fetchFeed(url: string, userAgent: string): Promise<FeedEntry[]> {
  const res = await http(url, { userAgent, headers: { accept: "application/atom+xml, application/rss+xml, application/xml;q=0.9" } });
  const xml = await res.text();
  const feed = await parser.parseString(xml);
  return feed.items.map((it) => ({
    id: it.guid ?? (it as { id?: string }).id ?? it.link ?? "",
    link: it.link ?? "",
    title: it.title,
    author: (it as { author?: string }).author ?? it.creator,
    content: stripHtml((it as { contentEncoded?: string }).contentEncoded ?? (it as { contentHtml?: string }).contentHtml ?? it.contentSnippet ?? it.content ?? ""),
    isoDate: it.isoDate,
  })).filter((e) => e.id && e.link);
}

export function stripHtml(s: string) {
  return s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, "\n\n").trim();
}
