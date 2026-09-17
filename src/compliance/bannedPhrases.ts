/**
 * Compliance-as-code: the claims we will not make in public, enforced mechanically.
 * Hard-fails in the publisher — a draft that trips this NEVER posts, whatever the approver clicked.
 *
 * Deployment-specific rules live outside git, in the JSON file named by COMPLIANCE_RULES_FILE
 * (see compliance-rules.example.json). They can only ADD rules; nothing in that file can disable
 * one of the six below.
 */
import { readFileSync } from "node:fs";

/**
 * `source` exists so callers can tell a built-in claim word (`guarantee`, `trustless` — public, safe
 * to record) from a locally-configured one, whose whole point is that it does not appear in git.
 * Anything that persists or transmits a hit must not include `phrase` when source is "local".
 */
export interface LintHit { phrase: string; index: number; why: string; source: "builtin" | "local" }

const RULES: Array<{ re: RegExp; why: string }> = [
  { re: /\b(zeus\s+(is|as|provides?|offers?)\s+(an?\s+)?escrow|our\s+escrow|escrow\s+(service|bot|platform))\b/i, why: "self-description as escrow" },
  { re: /\bguarantee[ds]?\b/i, why: "guarantee claim" },
  { re: /\btrustless\b/i, why: "trustless claim" },
  { re: /\brisk[- ]free\b/i, why: "risk-free claim" },
  { re: /\bno\s+middle?men\b/i, why: "'no middlemen' claim" },
  { re: /\b(never|can'?t|cannot)\s+(be\s+)?(scammed|lose\s+(your\s+)?money)\b/i, why: "absolute safety claim" },
];

interface LocalRule { id?: string; re?: string; flags?: string; why?: string; mustMatch?: string[]; mustNotMatch?: string[] }

/**
 * Read once, at module load, and self-tested before it is trusted: every rule must match each of
 * its own mustMatch samples and none of its mustNotMatch ones. A file that is configured but
 * missing, malformed, or failing its own samples exits the process rather than linting with fewer
 * rules than the operator configured — silent under-blocking is the failure this exists to stop.
 * Nothing here logs a pattern or a matched string, only rule ids, so the rules stay out of the journal.
 */
function loadLocalRules(): Array<{ re: RegExp; why: string; source: "local" }> {
  const path = process.env.COMPLIANCE_RULES_FILE;
  if (!path) {
    // Say so out loud. An unconfigured linter looks identical to a working one, and the whole
    // mechanism is pointless if nobody notices the extra rules are not loaded.
    console.warn(`compliance rules: COMPLIANCE_RULES_FILE is not set — only the ${RULES.length} built-in rules apply`);
    return [];
  }
  const die = (msg: string): never => {
    console.error(`compliance rules (${path}): ${msg}`);
    return process.exit(1);
  };

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    return die(`cannot read the rules file (${(err as NodeJS.ErrnoException).code ?? "unknown error"})`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Deliberately not echoing the parser's message: it quotes the surrounding file text.
    return die("not valid JSON");
  }
  if (!Array.isArray(parsed)) return die("expected a JSON array of rules");

  const samples = (v: unknown, id: string, field: string): string[] => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.some((s) => typeof s !== "string")) die(`rule ${id}: "${field}" must be an array of strings`);
    return v as string[];
  };

  return parsed.map((rule: LocalRule, i): { re: RegExp; why: string; source: "local" } => {
    const id = typeof rule?.id === "string" && rule.id ? rule.id : `#${i}`;
    if (typeof rule?.re !== "string" || !rule.re) die(`rule ${id}: "re" must be a non-empty string`);
    const flags = rule.flags ?? "i";
    if (/[gy]/.test(flags)) die(`rule ${id}: the g and y flags are not allowed (they make a rule stateful between drafts)`);
    let re: RegExp;
    try {
      re = new RegExp(rule.re as string, flags);
    } catch (err) {
      // V8 phrases this as "Invalid regular expression: /<pattern>/<flags>: <reason>" — keep the
      // reason, drop the pattern, so a rule never reaches the journal even when it is malformed.
      return die(`rule ${id}: not a valid regular expression — ${(err as Error).message.split(": ").pop()}`);
    }
    for (const sample of samples(rule.mustMatch, id, "mustMatch")) {
      if (!re.test(sample)) die(`rule ${id}: a mustMatch sample did not match — the rule does not do what it claims`);
    }
    for (const sample of samples(rule.mustNotMatch, id, "mustNotMatch")) {
      if (re.test(sample)) die(`rule ${id}: a mustNotMatch sample matched — the rule is too broad`);
    }
    return { re, why: `local rule (${id})`, source: "local" };
  });
}

const ALL_RULES: Array<{ re: RegExp; why: string; source: "builtin" | "local" }> = [
  ...RULES.map((r) => ({ ...r, source: "builtin" as const })),
  ...loadLocalRules(),
];

export function lintBannedPhrases(text: string): LintHit[] {
  const hits: LintHit[] = [];
  for (const { re, why, source } of ALL_RULES) {
    const m = re.exec(text);
    if (m) hits.push({ phrase: m[0], index: m.index, why, source });
  }
  return hits;
}

/** Safe to persist or send: drops the matched text for locally-configured rules. */
export function redactHits(hits: LintHit[]): Array<Partial<LintHit>> {
  return hits.map((h) => (h.source === "local" ? { why: h.why, index: h.index, source: h.source } : h));
}
