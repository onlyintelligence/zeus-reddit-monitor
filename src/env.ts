import { z } from "zod";

const csv = (s: string | undefined) =>
  (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().url(),

  // Subscription auth for the Agent SDK (claude setup-token). API keys are deliberately not supported here.
  CLAUDE_CODE_OAUTH_TOKEN: z.string().startsWith("sk-ant-oat01-").optional(),
  TRIAGE_MODEL: z.string().default("claude-haiku-4-5"),
  DRAFT_MODEL: z.string().default("claude-sonnet-5"),

  // Email digest: the only output. Gmail: create an App Password, SMTP smtp.gmail.com:465.
  DIGEST_TO: z.string().email(),
  DIGEST_FROM: z.string().email(),
  SMTP_HOST: z.string().default("smtp.gmail.com"),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_USER: z.string().min(1),
  SMTP_PASS: z.string().min(1),
  DIGEST_EVERY_HOURS: z.coerce.number().int().positive().default(2),

  // Reading needs none of the credentials below; posting does, and only in api mode.
  REDDIT_USER_AGENT: z.string().min(10),
  REDDIT_POST_MODE: z.enum(["manual", "api"]).default("manual"),
  REDDIT_CLIENT_ID: z.string().optional(),
  REDDIT_CLIENT_SECRET: z.string().optional(),
  REDDIT_USERNAME: z.string().optional(),
  REDDIT_PASSWORD: z.string().optional(),
  REDDIT_SUBREDDITS: z.string().transform(csv).refine((a) => a.length > 0, "list at least one subreddit"),
  REDDIT_SEARCH_FEEDS: z.stringbool().default(false),
  REDDIT_MAX_REPLIES_PER_DAY: z.coerce.number().int().positive().default(4),

  DISCLOSURE_LINE: z.string().min(10),
  SANDBOX_LABEL: z.string().min(5),
  IDENTITY_PAGE_URL: z.string().url(),
  PURGE_AFTER_HOURS: z.coerce.number().int().positive().default(48),

  // Path to a JSON file of extra banned-phrase rules kept out of git (compliance-rules.example.json
  // shows the shape). Declared here so it is documented and validated; the linter reads it straight
  // from process.env at module load, so a rule set is never contingent on unrelated env being valid.
  COMPLIANCE_RULES_FILE: z.string().min(1).optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment:\n" + JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
    process.exit(1);
  }
  cached = parsed.data;
  return cached;
}
