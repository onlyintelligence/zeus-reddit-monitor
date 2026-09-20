import { z } from "zod";

const csv = (s: string | undefined) =>
  (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);

/**
 * A blank in `.env` arrives as "", not undefined, so `.optional()` alone is not
 * enough: an empty CLAUDE_CODE_OAUTH_TOKEN failed `.startsWith()` and stopped
 * `job:listen`, a job that never reads the token. Blank means UNSET.
 */
const blank = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), inner.optional());

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().url(),

  // Subscription auth for the Agent SDK (claude setup-token). API keys are deliberately not supported here.
  CLAUDE_CODE_OAUTH_TOKEN: blank(z.string().startsWith("sk-ant-oat01-")),
  TRIAGE_MODEL: z.string().default("claude-haiku-4-5"),
  DRAFT_MODEL: z.string().default("claude-sonnet-5"),

  // Email digest (the primary output). Gmail: create an App Password, SMTP smtp.gmail.com:465.
  // Credentials are optional AT BOOT and required AT USE, so the read-only
  // `job:listen` runs without an SMTP account. `requireDigestConfig()` in
  // digest/email.ts is what refuses to send without them.
  DIGEST_TO: blank(z.string().email()),
  DIGEST_FROM: blank(z.string().email()),
  SMTP_HOST: z.string().default("smtp.gmail.com"),
  SMTP_PORT: z.coerce.number().default(465),
  SMTP_USER: blank(z.string().min(1)),
  SMTP_PASS: blank(z.string().min(1)),
  DIGEST_EVERY_HOURS: z.coerce.number().default(2),

  REDDIT_USER_AGENT: z.string().min(10),
  // "manual" is the default and the only mode that needs no credentials: the tool
  // emails a suggested reply and a human posts it. "api" requires approved Reddit
  // Data API access and the four credentials below, which are optional precisely
  // because the default mode never reads them.
  REDDIT_POST_MODE: z.enum(["manual", "api"]).default("manual"),
  REDDIT_CLIENT_ID: blank(z.string()),
  REDDIT_CLIENT_SECRET: blank(z.string()),
  REDDIT_USERNAME: blank(z.string()),
  REDDIT_PASSWORD: blank(z.string()),
  REDDIT_SUBREDDITS: z.string().transform(csv),
  REDDIT_MAX_REPLIES_PER_DAY: z.coerce.number().default(4),

  // Newline-separated regex sources appended to the claim linter. Never committed.
  EXTRA_BANNED_PATTERNS: z.string().default(""),
  DISCLOSURE_LINE: z.string().min(10),
  SANDBOX_LABEL: z.string().min(5),
  IDENTITY_PAGE_URL: z.string().url(),
  PURGE_AFTER_HOURS: z.coerce.number().default(48),
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
