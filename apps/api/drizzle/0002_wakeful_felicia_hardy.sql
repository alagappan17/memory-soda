CREATE TYPE "public"."semantic_status" AS ENUM('pending', 'processing', 'completed', 'failed', 'skipped');--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "semantic_status" "semantic_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "semantic_retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "episodes_semantic_status_idx" ON "episodes" USING btree ("semantic_status","status");