# Phase 4 Migration Generation Output

## Command run

```
cd /work/personal/compass/apps/api && DATABASE_URL=postgres://x:x@localhost/x npx drizzle-kit generate
```

## drizzle-kit output

```
No config path provided, using default 'drizzle.config.ts'
Reading config file '/work/personal/compass/apps/api/drizzle.config.ts'
54 tables
account_nps_details 9 columns 0 indexes 2 fks
ai_events 14 columns 1 indexes 3 fks
ai_settings 7 columns 0 indexes 1 fks
alert_ledger 5 columns 1 indexes 1 fks
attachments 7 columns 1 indexes 1 fks
bank_details 10 columns 0 indexes 2 fks
budget_alerts 6 columns 1 indexes 2 fks
budget_lines 7 columns 1 indexes 2 fks
budgets 6 columns 1 indexes 1 fks
card_details 10 columns 0 indexes 2 fks
card_issuer_settings 8 columns 0 indexes 1 fks
card_statements 9 columns 1 indexes 2 fks
emi_details 10 columns 0 indexes 3 fks
extracted_transactions 20 columns 3 indexes 6 fks
gold_details 7 columns 0 indexes 2 fks
holding_events 11 columns 2 indexes 2 fks
holding_valuations 6 columns 1 indexes 1 fks
household_invites 8 columns 1 indexes 3 fks
household_members 5 columns 2 indexes 2 fks
households 5 columns 0 indexes 1 fks
import_presets 7 columns 1 indexes 2 fks
import_rows 16 columns 2 indexes 1 fks
imports 11 columns 1 indexes 2 fks
insurance_health_cards 9 columns 1 indexes 2 fks
mailbox_credentials 7 columns 1 indexes 1 fks
merchant_rules 5 columns 1 indexes 1 fks
net_worth_snapshots 8 columns 1 indexes 1 fks
notification_prefs 9 columns 1 indexes 2 fks
notifications 9 columns 1 indexes 1 fks
nps_details 9 columns 0 indexes 2 fks
overdraft_details 6 columns 0 indexes 2 fks
projection_settings 4 columns 0 indexes 1 fks
retirement_details 8 columns 0 indexes 2 fks
reward_entries 8 columns 2 indexes 3 fks
subscription_dismissals 4 columns 1 indexes 1 fks
transaction_links 5 columns 1 indexes 1 fks
user_profiles 4 columns 0 indexes 1 fks
user_tasks 11 columns 3 indexes 2 fks
users 7 columns 0 indexes 0 fks
categories 12 columns 2 indexes 1 fks
goals 12 columns 1 indexes 2 fks
mailbox_accounts 13 columns 1 indexes 1 fks
resources 11 columns 1 indexes 1 fks
accounts 18 columns 2 indexes 4 fks
email_ingestions 13 columns 2 indexes 2 fks
family_members 14 columns 2 indexes 2 fks
recurring_templates 17 columns 1 indexes 4 fks
holdings 14 columns 1 indexes 2 fks
insurance_policies 29 columns 1 indexes 3 fks
policy_covered_persons 2 columns 0 indexes 2 fks
sips 15 columns 3 indexes 5 fks
statement_reconciliations 19 columns 2 indexes 3 fks
postings 8 columns 3 indexes 3 fks
transactions 16 columns 6 indexes 6 fks

[✓] Your SQL migration file ➜ drizzle/0001_lush_grim_reaper.sql 🚀
```

## Migration files after generation

```
-rw-r--r-- udai udai  55 KB Fri Aug 14 19:23:29 2026 /work/personal/compass/apps/api/drizzle/0000_nosy_lizard.sql
-rw-r--r-- udai udai 4.9 KB Sat Aug 15 01:40:45 2026 /work/personal/compass/apps/api/drizzle/0001_lush_grim_reaper.sql
```

## Full contents of `0001_lush_grim_reaper.sql` (new migration)

```sql
CREATE TYPE "public"."household_role" AS ENUM('owner', 'member');--> statement-breakpoint
ALTER TYPE "public"."family_relationship" ADD VALUE 'self' BEFORE 'spouse';--> statement-breakpoint
CREATE TABLE "household_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"invited_by_user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_by_user_id" uuid,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "household_role" DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_covered_persons" (
	"policy_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	CONSTRAINT "policy_covered_persons_policy_id_person_id_pk" PRIMARY KEY("policy_id","person_id")
);
--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN "linked_user_id" uuid;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "beneficiary_id" uuid;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "holder_id" uuid;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD COLUMN "nominee_person_id" uuid;--> statement-breakpoint
ALTER TABLE "household_invites" ADD CONSTRAINT "household_invites_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_invites" ADD CONSTRAINT "household_invites_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_invites" ADD CONSTRAINT "household_invites_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "households_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_covered_persons" ADD CONSTRAINT "policy_covered_persons_policy_id_insurance_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."insurance_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_covered_persons" ADD CONSTRAINT "policy_covered_persons_person_id_family_members_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."family_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "household_invites_token_idx" ON "household_invites" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "household_members_unique_idx" ON "household_members" USING btree ("household_id","user_id");--> statement-breakpoint
CREATE INDEX "household_members_user_idx" ON "household_members" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_linked_user_id_users_id_fk" FOREIGN KEY ("linked_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_beneficiary_id_family_members_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."family_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_holder_id_family_members_id_fk" FOREIGN KEY ("holder_id") REFERENCES "public"."family_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_nominee_person_id_family_members_id_fk" FOREIGN KEY ("nominee_person_id") REFERENCES "public"."family_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "family_members_linked_user_idx" ON "family_members" USING btree ("linked_user_id") WHERE linked_user_id is not null;
```
