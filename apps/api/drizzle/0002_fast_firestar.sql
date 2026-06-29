CREATE TYPE "public"."semantic_status" AS ENUM('pending', 'processing', 'completed', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"embedding" vector(768),
	"fact_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"predicate" text NOT NULL,
	"object" text NOT NULL,
	"object_is_entity" boolean DEFAULT false NOT NULL,
	"context_entity_name" text,
	"confidence" real DEFAULT 1 NOT NULL,
	"episode_id" uuid,
	"valid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ingestion_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invalid_at" timestamp with time zone,
	"embedding" vector(768),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "semantic_status" "semantic_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entities_user_project_name_idx" ON "entities" USING btree ("user_id","project_id","name");--> statement-breakpoint
CREATE INDEX "facts_user_project_invalid_idx" ON "facts" USING btree ("user_id","project_id","invalid_at");--> statement-breakpoint
CREATE INDEX "facts_user_project_subject_idx" ON "facts" USING btree ("user_id","project_id","subject");--> statement-breakpoint
CREATE INDEX "facts_user_project_context_idx" ON "facts" USING btree ("user_id","project_id","context_entity_name");--> statement-breakpoint
CREATE INDEX "facts_episode_idx" ON "facts" USING btree ("episode_id");--> statement-breakpoint
-- Specialised indexes (hand-added; drizzle-kit does not emit these from the vector customType).
-- ivfflat cosine over fact/entity embeddings, mirroring episodes_embedding_idx.
CREATE INDEX "facts_embedding_idx" ON "facts" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100) WHERE "embedding" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "entities_embedding_idx" ON "entities" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100) WHERE "embedding" IS NOT NULL;--> statement-breakpoint
-- Expression GIN index for keyword search. The retrieval query MUST use this exact
-- to_tsvector expression for the planner to use the index.
CREATE INDEX "facts_tsv_idx" ON "facts" USING gin (to_tsvector('english', coalesce("subject", '') || ' ' || coalesce("predicate", '') || ' ' || coalesce("object", '') || ' ' || coalesce("context_entity_name", '')));