-- userId → dataset: the store identifier is a generic dataset key the developer
-- derives (e.g. a hash of their user id), not necessarily a user. Data preserved.
ALTER TABLE "threads" RENAME COLUMN "user_id" TO "dataset";--> statement-breakpoint
ALTER TABLE "episodes" RENAME COLUMN "user_id" TO "dataset";--> statement-breakpoint
ALTER TABLE "facts" RENAME COLUMN "user_id" TO "dataset";--> statement-breakpoint
ALTER TABLE "entities" RENAME COLUMN "user_id" TO "dataset";--> statement-breakpoint
ALTER INDEX "episodes_user_project_status_idx" RENAME TO "episodes_dataset_project_status_idx";--> statement-breakpoint
ALTER INDEX "episodes_user_created_idx" RENAME TO "episodes_dataset_created_idx";--> statement-breakpoint
ALTER INDEX "facts_user_project_invalid_idx" RENAME TO "facts_dataset_project_invalid_idx";--> statement-breakpoint
ALTER INDEX "facts_user_project_subject_idx" RENAME TO "facts_dataset_project_subject_idx";--> statement-breakpoint
ALTER INDEX "facts_user_project_object_idx" RENAME TO "facts_dataset_project_object_idx";--> statement-breakpoint
ALTER INDEX "facts_user_project_recency_idx" RENAME TO "facts_dataset_project_recency_idx";--> statement-breakpoint
ALTER INDEX "entities_user_project_name_idx" RENAME TO "entities_dataset_project_name_idx";
