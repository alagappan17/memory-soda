CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant', 'system', 'tool');
--> statement-breakpoint
CREATE TYPE "public"."episode_status" AS ENUM('pending', 'processing', 'completed', 'failed', 'deleted', 'archived');
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"settings" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"key_preview" text NOT NULL,
	"project_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	CONSTRAINT "api_keys_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"content" text NOT NULL,
	"source" text DEFAULT 'USER' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"embedding" vector(3072),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"tags" text[] NOT NULL DEFAULT '{}',
	"metadata" jsonb,
	"message_count" integer NOT NULL DEFAULT 0,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_at" timestamp with time zone NOT NULL DEFAULT now(),
	"last_activity_at" timestamp with time zone NOT NULL DEFAULT now(),
	"auto_compact_threshold" integer CHECK (auto_compact_threshold IS NULL OR auto_compact_threshold >= 1),
	"episodic_settings" jsonb,
	"last_compacted_at" timestamp with time zone,
	"last_compacted_sequence" integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"sequence_number" integer NOT NULL,
	"token_count" jsonb,
	"model" text,
	"latency_ms" integer CHECK ("latency_ms" >= 0),
	"metadata" jsonb,
	"compacted_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid,
	"user_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"status" "episode_status" NOT NULL DEFAULT 'pending',
	"summary" text,
	"key_learnings" jsonb,
	"embedding" vector(768),
	"message_count" integer NOT NULL DEFAULT 0,
	"token_count" integer,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"processing_started_at" timestamp with time zone,
	"processing_completed_at" timestamp with time zone,
	"error" text,
	"retry_count" integer NOT NULL DEFAULT 0,
	"metadata" jsonb,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "memories_user_id_idx" ON "memories" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "threads_tags_idx" ON "threads" USING gin ("tags");
--> statement-breakpoint
CREATE INDEX "threads_activity_idx" ON "threads" USING btree ("last_activity_at");
--> statement-breakpoint
CREATE INDEX "threads_project_idx" ON "threads" USING btree ("project_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "messages_thread_seq_idx" ON "messages" USING btree ("thread_id", "sequence_number");
--> statement-breakpoint
CREATE INDEX "messages_thread_time_idx" ON "messages" USING btree ("thread_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "messages_thread_compacted_idx" ON "messages" USING btree ("thread_id", "compacted_at");
--> statement-breakpoint
CREATE INDEX "episodes_user_project_status_idx" ON "episodes" USING btree ("user_id", "project_id", "status");
--> statement-breakpoint
CREATE INDEX "episodes_user_created_idx" ON "episodes" USING btree ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX "episodes_thread_idx" ON "episodes" USING btree ("thread_id");
--> statement-breakpoint
CREATE INDEX "episodes_status_created_idx" ON "episodes" USING btree ("status", "created_at");
--> statement-breakpoint
CREATE INDEX "episodes_embedding_idx" ON "episodes" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100) WHERE "embedding" IS NOT NULL;
