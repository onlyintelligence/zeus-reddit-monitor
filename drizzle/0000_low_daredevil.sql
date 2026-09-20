CREATE TYPE "public"."item_status" AS ENUM('new', 'triaged', 'drafted', 'pending_approval', 'approved', 'skipped', 'posted', 'failed', 'purged');--> statement-breakpoint
CREATE TYPE "public"."job_kind" AS ENUM('reply', 'post');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'manual_pending', 'posting', 'posted', 'failed');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('reddit');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"ref_id" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "counters" (
	"key" text PRIMARY KEY NOT NULL,
	"value" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cursors" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text,
	"platform" "platform" NOT NULL,
	"kind" "job_kind" NOT NULL,
	"text" text NOT NULL,
	"media_path" text,
	"model" text,
	"emailed_at" timestamp with time zone,
	"decided_by" text,
	"decision" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" text PRIMARY KEY NOT NULL,
	"platform" "platform" NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"container" text NOT NULL,
	"author" text,
	"title" text,
	"body" text,
	"published_at" timestamp with time zone NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "item_status" DEFAULT 'new' NOT NULL,
	"triage" jsonb,
	"triaged_at" timestamp with time zone,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "publish_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"draft_id" text NOT NULL,
	"platform" "platform" NOT NULL,
	"kind" "job_kind" NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"not_before" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"external_result_id" text,
	"external_result_url" text,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_jobs" ADD CONSTRAINT "publish_jobs_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "items_platform_ext_idx" ON "items" USING btree ("platform","external_id");--> statement-breakpoint
CREATE INDEX "items_status_idx" ON "items" USING btree ("status","seen_at");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "publish_jobs" USING btree ("status","not_before");