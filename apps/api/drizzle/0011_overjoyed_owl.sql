CREATE TABLE "usage_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"project_id" uuid NOT NULL,
	"dataset" text,
	"source" text NOT NULL,
	"api_key_id" uuid,
	"user_id" uuid,
	"request_id" uuid,
	"operation" text NOT NULL,
	"stage" text NOT NULL,
	"kind" text NOT NULL,
	"service" text,
	"model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"input_chars" integer DEFAULT 0 NOT NULL,
	"calls" integer DEFAULT 1 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"ok" boolean DEFAULT true NOT NULL,
	"error" text,
	"thread_id" uuid,
	"episode_id" uuid,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_logs_project_created_idx" ON "usage_logs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_logs_request_idx" ON "usage_logs" USING btree ("request_id");