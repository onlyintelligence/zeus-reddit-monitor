import { env } from "../env.js";

/** Replies that mention Zeus must carry the disclosure line. Idempotent. */
export function ensureDisclosure(text: string, mentionsZeus: boolean): string {
  if (!mentionsZeus) return text;
  const d = env().DISCLOSURE_LINE;
  return text.includes(d) ? text : `${text.trimEnd()}\n\n${d}`;
}

export function mentionsZeus(text: string) {
  return /\bzeus\b/i.test(text) || text.includes(env().IDENTITY_PAGE_URL);
}
