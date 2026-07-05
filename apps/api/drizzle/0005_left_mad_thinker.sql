DROP TABLE IF EXISTS "memories" CASCADE;--> statement-breakpoint
-- The old keyword GIN index references context_entity_name; drop it before the
-- column so the DROP COLUMN can't fail on the dependency. 0006 recreates it.
DROP INDEX IF EXISTS "facts_tsv_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "facts_user_project_context_idx";--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN IF NOT EXISTS "semantic_retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN IF NOT EXISTS "start_sequence" integer;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN IF NOT EXISTS "end_sequence" integer;--> statement-breakpoint
ALTER TABLE "entities" DROP COLUMN IF EXISTS "attributes";--> statement-breakpoint
ALTER TABLE "entities" DROP COLUMN IF EXISTS "fact_count";--> statement-breakpoint
ALTER TABLE "facts" DROP COLUMN IF EXISTS "context_entity_name";--> statement-breakpoint
ALTER TABLE "facts" DROP COLUMN IF EXISTS "confidence";--> statement-breakpoint
ALTER TABLE "facts" DROP COLUMN IF EXISTS "ingestion_at";
