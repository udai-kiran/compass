CREATE TYPE "public"."email_class" AS ENUM('transaction_alert', 'card_statement', 'bill', 'otp', 'promo', 'other');--> statement-breakpoint
CREATE TYPE "public"."email_ingest_status" AS ENUM('pending', 'processing', 'extracted', 'deferred', 'ignored', 'failed');--> statement-breakpoint
CREATE TYPE "public"."extracted_txn_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."mailbox_provider" AS ENUM('google', 'microsoft');--> statement-breakpoint
CREATE TYPE "public"."mailbox_status" AS ENUM('active', 'disconnected', 'error');--> statement-breakpoint
CREATE TYPE "public"."txn_direction" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TABLE "email_ingestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"mailbox_id" uuid,
	"message_id" text NOT NULL,
	"from_addr" text DEFAULT '' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"received_at" timestamp with time zone,
	"raw" text NOT NULL,
	"classification" "email_class",
	"status" "email_ingest_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extracted_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ingestion_id" uuid NOT NULL,
	"amount_paise" bigint NOT NULL,
	"direction" "txn_direction" NOT NULL,
	"occurred_at" date,
	"counterparty" text DEFAULT '' NOT NULL,
	"suggested_account_id" uuid,
	"bank_ref" text,
	"source_quote" text DEFAULT '' NOT NULL,
	"confidence" double precision,
	"dedupe_hash" text,
	"status" "extracted_txn_status" DEFAULT 'pending' NOT NULL,
	"transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailbox_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "mailbox_provider" NOT NULL,
	"email_address" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"folder" text DEFAULT 'INBOX' NOT NULL,
	"status" "mailbox_status" DEFAULT 'active' NOT NULL,
	"last_error" text,
	"uid_validity" bigint,
	"last_uid" bigint,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_ingestions" ADD CONSTRAINT "email_ingestions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_ingestions" ADD CONSTRAINT "email_ingestions_mailbox_id_mailbox_accounts_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailbox_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracted_transactions" ADD CONSTRAINT "extracted_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracted_transactions" ADD CONSTRAINT "extracted_transactions_ingestion_id_email_ingestions_id_fk" FOREIGN KEY ("ingestion_id") REFERENCES "public"."email_ingestions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracted_transactions" ADD CONSTRAINT "extracted_transactions_suggested_account_id_accounts_id_fk" FOREIGN KEY ("suggested_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracted_transactions" ADD CONSTRAINT "extracted_transactions_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_accounts" ADD CONSTRAINT "mailbox_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_ingestions_msgid_idx" ON "email_ingestions" USING btree ("user_id","message_id");--> statement-breakpoint
CREATE INDEX "email_ingestions_status_idx" ON "email_ingestions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "extracted_transactions_status_idx" ON "extracted_transactions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "extracted_transactions_ingestion_idx" ON "extracted_transactions" USING btree ("ingestion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "extracted_transactions_dedupe_idx" ON "extracted_transactions" USING btree ("user_id","dedupe_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "mailbox_accounts_addr_idx" ON "mailbox_accounts" USING btree ("user_id","email_address");