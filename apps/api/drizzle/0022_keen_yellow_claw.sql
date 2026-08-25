CREATE TABLE "capital_loss_carryforward" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"origin_fy" text NOT NULL,
	"loss_kind" text NOT NULL,
	"original_paise" bigint NOT NULL,
	"remaining_paise" bigint NOT NULL,
	"expires_fy" text NOT NULL,
	"return_filed" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capital_loss_kind_check" CHECK ("capital_loss_carryforward"."loss_kind" IN ('STCL', 'LTCL')),
	CONSTRAINT "capital_loss_paise_pos" CHECK ("capital_loss_carryforward"."original_paise" > 0 AND "capital_loss_carryforward"."remaining_paise" >= 0)
);
--> statement-breakpoint
ALTER TABLE "capital_loss_carryforward" ADD CONSTRAINT "capital_loss_carryforward_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "capital_loss_cf_user_fy_idx" ON "capital_loss_carryforward" USING btree ("user_id","origin_fy");