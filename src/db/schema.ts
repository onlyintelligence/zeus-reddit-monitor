import { pgTable, text, timestamp, integer, boolean, jsonb, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import type { TriageResult } from "../types.js";

// Reddit only. The wider internal tool carries more members; this repo does not,
// so a row can never reference a platform this codebase has no code for.
export const platformEnum = pgEnum("platform", ["reddit"]);
export const itemStatusEnum = pgEnum("item_status", ["new", "triaged", "drafted", "pending_approval", "approved", "skipped", "posted", "failed", "purged"]);
export const jobKindEnum = pgEnum("job_kind", ["reply", "post"]);
export const jobStatusEnum = pgEnum("job_status", ["queued", "manual_pending", "posting", "posted", "failed"]);

/** Everything a listener finds. Body is purged after PURGE_AFTER_HOURS unless approved/posted. */
export const items = pgTable("items", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  platform: platformEnum("platform").notNull(),
  externalId: text("external_id").notNull(),
  url: text("url").notNull(),
  container: text("container").notNull(),
  author: text("author"),
  title: text("title"),
  body: text("body"),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
  status: itemStatusEnum("status").notNull().default("new"),
  triage: jsonb("triage").$type<TriageResult>(),
  triagedAt: timestamp("triaged_at", { withTimezone: true }),
  raw: jsonb("raw"),
}, (t) => [
  uniqueIndex("items_platform_ext_idx").on(t.platform, t.externalId),
  index("items_status_idx").on(t.status, t.seenAt),
]);

/** A drafted reply/post awaiting or past human decision. */
export const drafts = pgTable("drafts", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  itemId: text("item_id").references(() => items.id, { onDelete: "set null" }),
  platform: platformEnum("platform").notNull(),
  kind: jobKindEnum("kind").notNull(),
  text: text("text").notNull(),
  mediaPath: text("media_path"),
  model: text("model"),
  emailedAt: timestamp("emailed_at", { withTimezone: true }),
  decidedBy: text("decided_by"),
  decision: text("decision"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Approved work for the publisher. One row per platform action. */
export const publishJobs = pgTable("publish_jobs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  draftId: text("draft_id").notNull().references(() => drafts.id),
  platform: platformEnum("platform").notNull(),
  kind: jobKindEnum("kind").notNull(),
  status: jobStatusEnum("status").notNull().default("queued"),
  notBefore: timestamp("not_before", { withTimezone: true }).notNull().defaultNow(),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  externalResultId: text("external_result_id"),
  externalResultUrl: text("external_result_url"),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("jobs_status_idx").on(t.status, t.notBefore)]);

// No `tokens` table. Reddit posting is manual, so this tool holds no OAuth
// credential for any account and has nowhere to put one.

/** Cursors for incremental listening. */
export const cursors = pgTable("cursors", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Daily counters for the reply cap. */
export const counters = pgTable("counters", {
  key: text("key").primaryKey(),
  value: integer("value").notNull().default(0),
});

export const auditLog = pgTable("audit_log", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  refId: text("ref_id"),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  enabled: boolean("enabled").notNull().default(true),
});
