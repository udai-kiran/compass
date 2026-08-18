CREATE TYPE "public"."household_role" AS ENUM('owner', 'member');--> statement-breakpoint
ALTER TYPE "public"."family_relationship" RENAME TO "family_relationship_old";--> statement-breakpoint
CREATE TYPE "public"."family_relationship" AS ENUM ('self','spouse','child','parent','sibling','other');--> statement-breakpoint
ALTER TABLE "family_members" ALTER COLUMN "relationship"
  TYPE "public"."family_relationship"
  USING "relationship"::text::"public"."family_relationship";--> statement-breakpoint
DROP TYPE "public"."family_relationship_old";--> statement-breakpoint
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
CREATE UNIQUE INDEX "family_members_linked_user_idx" ON "family_members" USING btree ("linked_user_id") WHERE linked_user_id is not null;--> statement-breakpoint
-- Data migration: create a "self" person for every existing user that lacks one.
-- sort_order = -1 places it before all manually-created family members (which start at 0).
INSERT INTO family_members (id, user_id, name, relationship, linked_user_id, sort_order, created_at, updated_at)
SELECT gen_random_uuid(), u.id, u.display_name, 'self', u.id, -1, now(), now()
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM family_members fm WHERE fm.user_id = u.id AND fm.relationship = 'self'
);