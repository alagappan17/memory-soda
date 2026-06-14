CREATE TYPE "public"."episode_status" AS ENUM('pending', 'processing', 'completed', 'failed', 'deleted', 'archived');--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid,
	"user_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"status" "episode_status" DEFAULT 'pending' NOT NULL,
	"summary" text,
	"key_learnings" jsonb,
	"embedding" vector(768),
	"message_count" integer DEFAULT 0 NOT NULL,
	"token_count" integer,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"processing_started_at" timestamp with time zone,
	"processing_completed_at" timestamp with time zone,
	"error" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "threads" DROP CONSTRAINT IF EXISTS "threads_api_key_id_api_keys_id_fk";
--> statement-breakpoint
ALTER TABLE "threads" DROP CONSTRAINT IF EXISTS "threads_api_key_id_api_keys_id_fk";
--> statement-breakpoint
INSERT INTO "projects" ("name", "description")
SELECT 'default', 'Auto-created default project'
WHERE EXISTS (SELECT 1 FROM "api_keys" WHERE "project_id" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "projects" WHERE "name" = 'default');--> statement-breakpoint
UPDATE "api_keys"
SET "project_id" = (SELECT "id" FROM "projects" WHERE "name" = 'default' LIMIT 1)
WHERE "project_id" IS NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "threads" ALTER COLUMN "api_key_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "settings" jsonb;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "project_id" uuid;--> statement-breakpoint
UPDATE "threads" t
SET "project_id" = k."project_id"
FROM "api_keys" k
WHERE t."api_key_id" = k."id";--> statement-breakpoint
ALTER TABLE "threads" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "episodic_settings" jsonb;--> statement-breakpoint
ALTER TABLE "memories" ALTER COLUMN "created_at" TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "memories" ALTER COLUMN "updated_at" TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "episodes_user_project_status_idx" ON "episodes" USING btree ("user_id","project_id","status");--> statement-breakpoint
CREATE INDEX "episodes_user_created_idx" ON "episodes" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "episodes_thread_idx" ON "episodes" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "episodes_status_created_idx" ON "episodes" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "episodes_embedding_idx" ON "episodes" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100) WHERE "embedding" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "threads_project_idx" ON "threads" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "threads" DROP COLUMN "ended_at";--> statement-breakpoint
ALTER TABLE "threads" DROP COLUMN "api_key_id";
