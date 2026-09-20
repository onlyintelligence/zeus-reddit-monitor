import { env } from "../env.js";

/** Replies that mention Zeus must carry the disclosure line. Idempotent. */
export function ensureDisclosure(text: string, mentionsZeus: boolean): string {
  if (!mentionsZeus) return text;
  const d = env().DISCLOSURE_LINE;
  return text.includes(d) ? text : `${text.trimEnd()}\n\n${d}`;
}

/** Any public post about the product carries the sandbox label while sandbox is accurate. */
export function ensureSandboxLabel(text: string): string {
  const s = env().SANDBOX_LABEL;
  return text.includes(s) ? text : `${text.trimEnd()}\n\n${s}`;
}

export function mentionsZeus(text: string) {
  return /\bzeus\b/i.test(text) || text.includes(env().IDENTITY_PAGE_URL);
}
