/**
 * Compliance-as-code. Claims we will not make, enforced at publish time regardless of what a human
 * approved. See docs/05-compliance.md.
 *
 * Six built-in rules cover claims that are inaccurate about this product (it is not an escrow provider,
 * per the regulatory memo) or unfalsifiable ("guaranteed", "risk-free"). Anything site-specific or
 * private goes in EXTRA_BANNED_PATTERNS, newline-separated regex sources, so that no local rule is
 * committed to source — a published suppression rule announces the thing it suppresses (ADR-012).
 */
export interface LintHit { phrase: string; index: number; why: string }

const BUILT_IN: Array<{ re: RegExp; why: string }> = [
  { re: /\b(zeus\s+(is|as|provides?|offers?)\s+(an?\s+)?escrow|our\s+escrow|escrow\s+(service|bot|platform))\b/i, why: "self-description as escrow" },
  { re: /\bguarantee[ds]?\b/i, why: "guarantee claim" },
  { re: /\btrustless\b/i, why: "trustless claim" },
  { re: /\brisk[- ]free\b/i, why: "risk-free claim" },
  { re: /\bno\s+middle?men\b/i, why: "'no middlemen' claim" },
  { re: /\b(never|can'?t|cannot)\s+(be\s+)?(scammed|lose\s+(your\s+)?money)\b/i, why: "absolute safety claim" },
];

let extra: RegExp[] | undefined;
function extraRules(): RegExp[] {
  if (extra) return extra;
  // Newline-separated, NOT comma — regex quantifiers such as a{2,3} contain commas.
  const raw = (process.env.EXTRA_BANNED_PATTERNS ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  extra = [];
  for (const src of raw) {
    try { extra.push(new RegExp(src, "i")); }
    catch { console.error(`EXTRA_BANNED_PATTERNS: ignoring invalid regex: ${src}`); }
  }
  return extra;
}

export function lintBannedPhrases(text: string): LintHit[] {
  const hits: LintHit[] = [];
  for (const { re, why } of BUILT_IN) {
    const m = re.exec(text);
    if (m) hits.push({ phrase: m[0], index: m.index, why });
  }
  for (const re of extraRules()) {
    const m = re.exec(text);
    if (m) hits.push({ phrase: m[0], index: m.index, why: "local rule" });
  }
  return hits;
}
