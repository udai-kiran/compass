CREATE TABLE "epf_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wage_month" text NOT NULL,
	"employer_name" text,
	"epfo_member_id" text NOT NULL,
	"expected_employee_paise" bigint,
	"expected_employer_paise" bigint,
	"expected_eps_paise" bigint,
	"expected_vpf_paise" bigint DEFAULT 0 NOT NULL,
	"payslip_id" uuid,
	"actual_employee_paise" bigint,
	"actual_employer_paise" bigint,
	"actual_eps_paise" bigint,
	"actual_vpf_paise" bigint,
	"reconciliation_status" text DEFAULT 'pending' NOT NULL,
	"gap_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "epf_contributions" ADD CONSTRAINT "epf_contributions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epf_contributions" ADD CONSTRAINT "epf_contributions_payslip_id_payslips_id_fk" FOREIGN KEY ("payslip_id") REFERENCES "public"."payslips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "epf_contributions_user_month_member_idx" ON "epf_contributions" USING btree ("user_id","wage_month","epfo_member_id");--> statement-breakpoint
CREATE INDEX "epf_contributions_payslip_idx" ON "epf_contributions" USING btree ("payslip_id") WHERE payslip_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "epf_contributions_user_month_idx" ON "epf_contributions" USING btree ("user_id","wage_month");