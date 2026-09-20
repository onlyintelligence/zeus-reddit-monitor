/**
 * Promotion posture per community — what each community tolerates, in its own terms.
 *
 * The map itself is NOT committed. It lives in `posture.local.ts` (gitignored) because a public file
 * enumerating how each community treats product mentions reads as a plan to work around their rules,
 * however carefully it was written. See docs/08-decisions.md, ADR-011.
 *
 * Copy posture.local.example.ts → posture.local.ts and fill it from each community's own rules page.
 * Absent the file, every community falls back to the conservative default, which is the safe failure.
 */
import { child } from "../log.js";
const log = child("posture");

export type PostureMap = Record<string, string>;

export const DEFAULT_POSTURE =
  "Unknown community: assume promotion is unwelcome; helpful answer only, no product mention unless directly asked.";

let POSTURE: PostureMap = {};
let loaded = false;

/** Called once by the scheduler before the first job. Safe to call repeatedly. */
export async function loadPosture(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    // The specifier is a variable, not a literal, on purpose: this file is
    // gitignored and is absent from a fresh clone, so a literal import would be
    // a compile error in the one state the fallback below exists to handle.
    const spec = "./posture.local.js";
    const mod = (await import(spec)) as { POSTURE?: PostureMap };
    POSTURE = mod.POSTURE ?? {};
    log.info({ communities: Object.keys(POSTURE).length }, "posture loaded");
  } catch {
    log.warn("posture.local.ts absent — every community uses the conservative default; triage will skip more");
  }
}

export function postureFor(container: string): string {
  if (POSTURE[container]) return POSTURE[container];
  return DEFAULT_POSTURE;
}
