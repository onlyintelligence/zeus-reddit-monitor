import { pgTable, text, timestamp, integer, jsonb, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import type { TriageResult } from "../types.js";

export const platformEnum = pgEnum("platform", ["reddit"]);
export const itemStatusEnum = pgEnum("item_status", ["new", "triaged", "drafted", "skipped", "posted", "purged"]);
export const jobKindEnum = pgEnum("job_kind", ["reply"]);
export const jobStatusEnum = pgEnum("job_status", ["queued", "manual_pending", "posting", "posted", "failed"]);

/** Everything the listener finds. Body is purged after PURGE_AFTER_HOURS unless we replied to it. */
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

/** A drafted reply, emailed for a human to send. */
export const drafts = pgTable("drafts", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  itemId: text("item_id").references(() => items.id, { onDelete: "set null" }),
  platform: platformEnum("platform").notNull(),
  kind: jobKindEnum("kind").notNull(),
  text: text("text").notNull(),
  model: text("model"),
  emailedAt: timestamp("emailed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One row per reply the tool has prepared. Every row passes the publisher gate before it can be sent. */
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
});
