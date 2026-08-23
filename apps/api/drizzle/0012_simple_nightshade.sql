CREATE TYPE "public"."compounding_frequency" AS ENUM('monthly', 'quarterly', 'half_yearly', 'annually');--> statement-breakpoint
CREATE TYPE "public"."deposit_kind" AS ENUM('fd', 'rd', 'nsc', 'tax_saver_fd');--> statement-breakpoint
CREATE TYPE "public"."interest_disposition" AS ENUM('reinvest', 'payout');--> statement-breakpoint
CREATE TYPE "public"."tax_regime" AS ENUM('old', 'new');--> statement-breakpoint
CREATE TABLE "deposit_details" (
	"holding_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"deposit_kind" "deposit_kind" NOT NULL,
	"principal_paise" bigint,
	"installment_paise" bigint,
	"total_installments" integer,
	"annual_rate_bps" integer NOT NULL,
	"compounding_frequency" "compounding_frequency" NOT NULL,
	"interest_disposition" "interest_disposition" DEFAULT 'reinvest' NOT NULL,
	"payout_frequency" text,
	"start_date" date NOT NULL,
	"maturity_date" date NOT NULL,
	"auto_renewal" boolean DEFAULT false NOT NULL,
	"premature_closure_penalty_bps" integer,
	"joint_holder_name" text,
	"tds_section_applicable" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deposit_details_maturity_after_start" CHECK ("deposit_details"."maturity_date" > "deposit_details"."start_date"),
	CONSTRAINT "deposit_details_principal_or_installment" CHECK ("deposit_details"."principal_paise" > 0 OR "deposit_details"."installment_paise" > 0),
	CONSTRAINT "deposit_details_rd_needs_installment" CHECK ("deposit_details"."deposit_kind" <> 'rd' OR "deposit_details"."installment_paise" IS NOT NULL),
	CONSTRAINT "deposit_details_rd_needs_total_installments" CHECK ("deposit_details"."deposit_kind" <> 'rd' OR "deposit_details"."total_installments" IS NOT NULL),
	CONSTRAINT "deposit_details_non_rd_needs_principal" CHECK ("deposit_details"."deposit_kind" = 'rd' OR "deposit_details"."principal_paise" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "tax_regime_preferences" (
	"user_id" uuid NOT NULL,
	"fy" text NOT NULL,
	"chosen" text,
	"inferred_regime" text,
	"inferred_at" timestamp with time zone,
	"effective" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_regime_preferences_user_id_fy_pk" PRIMARY KEY("user_id","fy")
);
--> statement-breakpoint
ALTER TABLE "deposit_details" ADD CONSTRAINT "deposit_details_holding_id_holdings_id_fk" FOREIGN KEY ("holding_id") REFERENCES "public"."holdings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_details" ADD CONSTRAINT "deposit_details_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_regime_preferences" ADD CONSTRAINT "tax_regime_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;