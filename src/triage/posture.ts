/**
 * Per-subreddit posture: what that community's own rules allow, in its own terms.
 * A subreddit's rules are not available over RSS, so these notes are written by hand.
 *
 * The notes live in posture.local.json next to this file, which is not in git — see
 * posture.local.example.json for the shape. An absent or unreadable file yields an empty map, so
 * every subreddit falls through to the conservative default in postureFor(): assume promotion is
 * unwelcome, answer the question, mention nothing. Missing posture makes the tool quieter, never
 * louder.
 */
import { readFileSync } from "node:fs";
import { child } from "../log.js";

const log = child("posture");
const LOCAL = new URL("./posture.local.json", import.meta.url);

function load(): Record<string, string> {
  let raw: string;
  try {
    raw = readFileSync(LOCAL, "utf8");
  } catch {
    log.warn("posture.local.json absent — posture is empty; triage will be more conservative");
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("expected a JSON object");
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v !== "string") throw new Error("one of the values is not a string");
      if (!k.startsWith("//")) out[k] = v;
    }
    return out;
  } catch (err) {
    // Deliberately not echoing the error. Node's JSON.parse message quotes a snippet of the input,
    // so a half-written file would put the curated notes — the very thing this file keeps out of
    // git — straight into the journal. Same care as bannedPhrases.ts takes with its sibling file.
    const why = err instanceof SyntaxError ? "not valid JSON" : (err as Error).message;
    log.warn({ why }, "posture.local.json unusable — posture is empty; triage will be more conservative");
    return {};
  }
}

export const POSTURE: Record<string, string> = load();
export const postureFor = (subreddit: string) => POSTURE[subreddit] ?? "Unknown community: assume promotion is unwelcome; helpful answer only, no product mention unless directly asked.";
