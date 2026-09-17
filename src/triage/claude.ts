/**
 * Model calls go through the Claude Agent SDK, which spawns the Claude Code CLI and authenticates
 * with CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`). That bills the monthly Agent SDK credit
 * on a Pro/Max plan — NOT an API key. Never set ANTHROPIC_API_KEY in this process's environment.
 *
 * Structured output: options.outputFormat = { type: 'json_schema', schema } → result.structured_output.
 * The SDK validates against JSON Schema draft-07, so Zod 4 schemas are emitted with target 'draft-7'.
 * Each query() is a subprocess; callers batch many items per call to keep spawn overhead low.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { env } from "../env.js";
import { child } from "../log.js";
const log = child("agent");

export async function structured<S extends z.ZodType>(opts: { model: string; system: string; user: string; zod: S; effort?: "low" | "medium" | "high" }): Promise<z.infer<S>> {
  const e = env();
  if (process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is set — unset it so the SDK uses the subscription token");
  if (!e.CLAUDE_CODE_OAUTH_TOKEN) throw new Error("CLAUDE_CODE_OAUTH_TOKEN missing — run `claude setup-token` on a machine with a browser and paste it");
  const schema = z.toJSONSchema(opts.zod, { target: "draft-7" }) as Record<string, unknown>;
  let out: unknown; let cost = 0;
  for await (const m of query({
    prompt: opts.user,
    options: {
      model: opts.model,
      systemPrompt: { type: "custom", prompt: opts.system },
      tools: [],                       // pure inference: no file/bash/web tools
      maxTurns: 1,
      effort: opts.effort ?? "low",
      persistSession: false,
      outputFormat: { type: "json_schema", schema },
    },
  })) {
    if (m.type === "result") {
      if (m.subtype !== "success") throw new Error(`agent result ${m.subtype}`);
      out = m.structured_output; cost = m.total_cost_usd;
    }
  }
  if (out === undefined) throw new Error("no structured_output");
  log.debug({ model: opts.model, cost }, "agent call");
  return opts.zod.parse(out);
}
