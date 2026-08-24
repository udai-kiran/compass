CREATE TYPE "public"."deduction_kind" AS ENUM('nsc_additional', 'tuition_fees', 'elss_manual', 'nps_additional', 'employer_nps_ccd2', 'preventive_checkup', 'other_80c', 'other_80d');--> statement-breakpoint
CREATE TYPE "public"."deduction_section" AS ENUM('80C', '80D', '80CCD1B', '80CCD2');--> statement-breakpoint
CREATE TYPE "public"."eighty_d_group" AS ENUM('self_family', 'parents');--> statement-breakpoint
CREATE TABLE "deduction_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"fy" text NOT NULL,
	"section" "deduction_section" NOT NULL,
	"deduction_kind" "deduction_kind" NOT NULL,
	"amount_paise" bigint NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"employer_type" text,
	"salary_base_paise" bigint,
	"eighty_d_group" "eighty_d_group",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deduction_entries_amount_positive" CHECK ("deduction_entries"."amount_paise" > 0),
	CONSTRAINT "deduction_entries_ccd2_fields" CHECK ("deduction_entries"."section" <> '80CCD2' OR ("deduction_entries"."employer_type" IN ('private','government') AND "deduction_entries"."salary_base_paise" > 0)),
	CONSTRAINT "deduction_entries_80d_group" CHECK ("deduction_entries"."section" <> '80D' OR "deduction_entries"."eighty_d_group" IS NOT NULL),
	CONSTRAINT "deduction_entries_section_kind" CHECK (("deduction_entries"."section" = '80C' AND "deduction_entries"."deduction_kind" IN ('nsc_additional','tuition_fees','elss_manual','other_80c')) OR ("deduction_entries"."section" = '80CCD1B' AND "deduction_entries"."deduction_kind" = 'nps_additional') OR ("deduction_entries"."section" = '80CCD2' AND "deduction_entries"."deduction_kind" = 'employer_nps_ccd2') OR ("deduction_entries"."section" = '80D' AND "deduction_entries"."deduction_kind" IN ('preventive_checkup','other_80d')))
);
--> statement-breakpoint
ALTER TABLE "deduction_entries" ADD CONSTRAINT "deduction_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deduction_entries_user_fy_idx" ON "deduction_entries" USING btree ("user_id","fy");