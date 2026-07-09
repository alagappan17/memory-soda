-- Confidence moves from an extraction-time filter to a stored, retrieval-time
-- one: every structurally-valid fact is kept with its model-rated confidence,
-- and recall() filters by the project's retrievalMinConfidence.
ALTER TABLE "facts" ADD COLUMN IF NOT EXISTS "confidence" real DEFAULT 1 NOT NULL;--> statement-breakpoint
-- Wipe + re-extract so stored confidences are real (and facts the old
-- extraction-time filter silently dropped come back).
TRUNCATE TABLE "facts";--> statement-breakpoint
TRUNCATE TABLE "entities";--> statement-breakpoint
-- Ranged archived episodes cover distinct message windows and re-extract
-- safely; legacy NULL-range archived episodes stay skipped (their thread's
-- final completed episode covers the whole thread).
UPDATE "episodes" SET "semantic_status" = 'pending', "semantic_retry_count" = 0
  WHERE "semantic_status" IN ('completed', 'failed', 'skipped')
    AND ("status" = 'completed' OR ("status" = 'archived' AND "start_sequence" IS NOT NULL));--> statement-breakpoint
-- Retire the extraction-time knob from stored project settings.
UPDATE "projects" SET "settings" = "settings" #- '{semantic,minConfidence}' WHERE "settings" ? 'semantic';
