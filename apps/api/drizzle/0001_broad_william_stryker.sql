CREATE TABLE "scheduled_episodes" (
	"thread_id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"fire_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduled_episodes" ADD CONSTRAINT "scheduled_episodes_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_episodes" ADD CONSTRAINT "scheduled_episodes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_episodes_fire_at_idx" ON "scheduled_episodes" USING btree ("fire_at");