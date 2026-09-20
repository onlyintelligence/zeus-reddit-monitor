/**
 * Copy to `posture.local.ts` (gitignored) and fill from each community's OWN rules page.
 * Read the rules before writing a line here; do not infer them.
 *
 * Key = the `container` value the listener stores:
 *   Reddit → subreddit name, e.g. "PHGamers"
 *
 * Value = one sentence in that community's own terms. Where a community forbids promotion, say so
 * plainly — triage reads this and will refuse to draft a product mention.
 */
import type { PostureMap } from "./posture.js";

export const POSTURE: PostureMap = {
  // "ExampleSub": "Self-promotion banned outright. Helpful safety answers welcome. Never mention the product.",
};
