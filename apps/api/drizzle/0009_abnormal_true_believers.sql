CREATE TABLE "serviceability_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"price_source_id" uuid NOT NULL,
	"pincode" text NOT NULL,
	"is_serviceable" boolean,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "serviceability_checks_pincode_nonempty" CHECK (length("pincode") > 0)
);
--> statement-breakpoint
ALTER TABLE "serviceability_checks" ADD CONSTRAINT "serviceability_checks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serviceability_checks" ADD CONSTRAINT "serviceability_checks_price_source_id_price_sources_id_fk" FOREIGN KEY ("price_source_id") REFERENCES "public"."price_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "serviceability_checks_source_pincode_idx" ON "serviceability_checks" USING btree ("price_source_id","pincode");--> statement-breakpoint
CREATE INDEX "serviceability_checks_user_idx" ON "serviceability_checks" USING btree ("user_id");