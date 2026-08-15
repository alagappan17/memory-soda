-- threads.message_count was a denormalized counter maintained by addMessage on
-- every insert; it could drift and callers can derive it live from messages.
ALTER TABLE "threads" DROP COLUMN "message_count";--> statement-breakpoint
ALTER TABLE "messages" RENAME COLUMN "token_count" TO "tokens";
