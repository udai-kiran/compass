CREATE TABLE "capital_loss_setoff_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"fy" text NOT NULL,
	"total_absorbed_paise" bigint NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capital_loss_setoff_absorbed_non_neg" CHECK ("capital_loss_setoff_applications"."total_absorbed_paise" >= 0)
);
--> statement-breakpoint
ALTER TABLE "capital_loss_setoff_applications" ADD CONSTRAINT "capital_loss_setoff_applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "capital_loss_setoff_user_fy_uidx" ON "capital_loss_setoff_applications" USING btree ("user_id","fy");