CREATE TYPE "public"."ai_event_kind" AS ENUM('email_extract', 'statement_parse', 'statement_summary', 'categorize', 'summary', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."ai_event_status" AS ENUM('ok', 'error');--> statement-breakpoint
CREATE TYPE "public"."ai_provider" AS ENUM('none', 'anthropic', 'ollama', 'openrouter', 'deepseek', 'custom');--> statement-breakpoint
CREATE TYPE "public"."bank_account_subtype" AS ENUM('savings', 'current', 'salary', 'nre', 'nro');--> statement-breakpoint
CREATE TYPE "public"."budget_period" AS ENUM('monthly', 'annual');--> statement-breakpoint
CREATE TYPE "public"."card_network" AS ENUM('visa', 'mastercard', 'amex', 'rupay', 'diners');--> statement-breakpoint
CREATE TYPE "public"."education_stage" AS ENUM('preschool', 'primary', 'secondary', 'senior_secondary', 'undergraduate', 'postgraduate', 'doctorate', 'other');--> statement-breakpoint
CREATE TYPE "public"."extracted_txn_intent" AS ENUM('repayment', 'refund', 'cashback');--> statement-breakpoint
CREATE TYPE "public"."extracted_txn_status" AS ENUM('pending', 'accepted', 'rejected', 'duplicate');--> statement-breakpoint
CREATE TYPE "public"."family_relationship" AS ENUM('spouse', 'child', 'parent', 'sibling', 'other');--> statement-breakpoint
CREATE TYPE "public"."gold_form" AS ENUM('physical', 'digital', 'etf', 'sgb');--> statement-breakpoint
CREATE TYPE "public"."holding_event_source" AS ENUM('import', 'manual');--> statement-breakpoint
CREATE TYPE "public"."holding_event_type" AS ENUM('buy', 'sell', 'dividend');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('staged', 'committed', 'rolled_back');--> statement-breakpoint
CREATE TYPE "public"."nps_tier" AS ENUM('tier_i', 'tier_ii');--> statement-breakpoint
CREATE TYPE "public"."txn_direction" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TYPE "public"."category_kind" AS ENUM('income', 'expense');--> statement-breakpoint
CREATE TYPE "public"."expense_necessity" AS ENUM('essential', 'non_essential');--> statement-breakpoint
CREATE TYPE "public"."goal_type" AS ENUM('savings', 'emergency_fund', 'vacation', 'home', 'vehicle', 'education', 'retirement', 'custom');--> statement-breakpoint
CREATE TYPE "public"."mailbox_provider" AS ENUM('google', 'microsoft');--> statement-breakpoint
CREATE TYPE "public"."mailbox_status" AS ENUM('active', 'disconnected', 'error');--> statement-breakpoint
CREATE TYPE "public"."resource_kind" AS ENUM('vehicle', 'electricity', 'mobile', 'internet', 'gas', 'water', 'other');--> statement-breakpoint
CREATE TYPE "public"."account_system_kind" AS ENUM('expenses', 'income', 'opening', 'clearing');--> statement-breakpoint
CREATE TYPE "public"."account_type" AS ENUM('bank', 'cash', 'credit_card', 'investment', 'loan', 'overdraft', 'ppf', 'epf', 'ssy', 'nps', 'home_loan_od', 'insurance', 'system');--> statement-breakpoint
CREATE TYPE "public"."email_class" AS ENUM('transaction_alert', 'card_statement', 'bill', 'otp', 'promo', 'other');--> statement-breakpoint
CREATE TYPE "public"."email_ingest_status" AS ENUM('pending', 'processing', 'extracted', 'deferred', 'ignored', 'failed');--> statement-breakpoint
CREATE TYPE "public"."recurring_frequency" AS ENUM('daily', 'weekly', 'monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."recurring_kind" AS ENUM('none', 'bill', 'subscription', 'insurance', 'emi');--> statement-breakpoint
CREATE TYPE "public"."asset_class" AS ENUM('stock', 'mutual_fund', 'etf', 'gold', 'silver', 'fd', 'nps', 'real_estate', 'other');--> statement-breakpoint
CREATE TYPE "public"."gains_tax_class" AS ENUM('equity', 'unlisted_shares', 'other', 'specified_fund', 'market_linked_debenture', 'unlisted_bond', 'exempt');--> statement-breakpoint
CREATE TYPE "public"."health_type" AS ENUM('indemnity', 'top_up', 'critical_illness', 'hospital_cash', 'personal_accident', 'disease_specific');--> statement-breakpoint
CREATE TYPE "public"."insurance_kind" AS ENUM('life', 'health', 'vehicle');--> statement-breakpoint
CREATE TYPE "public"."premium_frequency" AS ENUM('monthly', 'quarterly', 'half_yearly', 'yearly', 'single');--> statement-breakpoint
CREATE TYPE "public"."sip_frequency" AS ENUM('monthly', 'quarterly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."sip_funding_source" AS ENUM('bank_debit', 'payroll');--> statement-breakpoint
CREATE TYPE "public"."sip_status" AS ENUM('active', 'paused');--> statement-breakpoint
CREATE TYPE "public"."sip_target_kind" AS ENUM('mf_folio', 'account');--> statement-breakpoint
CREATE TYPE "public"."vehicle_kind" AS ENUM('car', 'bike', 'other');--> statement-breakpoint
CREATE TYPE "public"."transaction_source" AS ENUM('manual', 'import', 'recurring');--> statement-breakpoint
CREATE TABLE "account_nps_details" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"pran" text DEFAULT '' NOT NULL,
	"tier" "nps_tier" DEFAULT 'tier_i' NOT NULL,
	"equity_pct" integer DEFAULT 0 NOT NULL,
	"corporate_pct" integer DEFAULT 0 NOT NULL,
	"govt_pct" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "ai_event_kind" NOT NULL,
	"status" "ai_event_status" NOT NULL,
	"provider" text DEFAULT '' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"ingestion_id" uuid,
	"account_id" uuid,
	"request_context" text DEFAULT '' NOT NULL,
	"response_raw" text DEFAULT '' NOT NULL,
	"latency_ms" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"provider" "ai_provider" DEFAULT 'none' NOT NULL,
	"api_key_enc" text DEFAULT '' NOT NULL,
	"base_url" text DEFAULT '' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ref_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"stored_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_details" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"account_number" text DEFAULT '' NOT NULL,
	"ifsc" text DEFAULT '' NOT NULL,
	"branch" text DEFAULT '' NOT NULL,
	"subtype" "bank_account_subtype",
	"required_amb_paise" bigint DEFAULT 0 NOT NULL,
	"debit_card_last4" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"category_id" uuid NOT NULL,
	"threshold" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"budget_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"amount_paise" bigint NOT NULL,
	"rollover" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"period" "budget_period" DEFAULT 'monthly' NOT NULL,
	"period_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_details" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"network" "card_network",
	"product_name" text DEFAULT '' NOT NULL,
	"cycle_day" integer DEFAULT 1 NOT NULL,
	"due_day" integer DEFAULT 15 NOT NULL,
	"earn_rate_per_100" integer DEFAULT 0 NOT NULL,
	"statement_password_enc" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_issuer_settings" (
	"user_id" uuid NOT NULL,
	"institution" text NOT NULL,
	"credit_limit_paise" bigint DEFAULT 0 NOT NULL,
	"utilization_alert_pct" integer DEFAULT 30,
	"remind_days" integer DEFAULT 3 NOT NULL,
	"bill_mobile" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_issuer_settings_user_id_institution_pk" PRIMARY KEY("user_id","institution")
);
--> statement-breakpoint
CREATE TABLE "card_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"period" date,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"stored_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emi_details" (
	"template_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"principal_paise" bigint NOT NULL,
	"annual_rate_bps" integer NOT NULL,
	"total_installments" integer NOT NULL,
	"start_date" date NOT NULL,
	"loan_account_id" uuid,
	"outstanding_principal_paise" bigint,
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
	"occurred_at_ts" timestamp with time zone,
	"counterparty" text DEFAULT '' NOT NULL,
	"suggested_account_id" uuid,
	"suggested_category_id" uuid,
	"intent" "extracted_txn_intent",
	"bank_ref" text,
	"source_quote" text DEFAULT '' NOT NULL,
	"confidence" double precision,
	"dedupe_hash" text,
	"status" "extracted_txn_status" DEFAULT 'pending' NOT NULL,
	"transaction_id" uuid,
	"matched_transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "family_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"relationship" "family_relationship" NOT NULL,
	"date_of_birth" date,
	"education_stage" "education_stage",
	"institution" text,
	"course_or_stream" text,
	"expected_completion_year" integer,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold_details" (
	"holding_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"form" "gold_form" DEFAULT 'physical' NOT NULL,
	"purity_karat" integer,
	"maturity_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holding_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"holding_id" uuid NOT NULL,
	"type" "holding_event_type" NOT NULL,
	"date" date NOT NULL,
	"amount_paise" bigint NOT NULL,
	"units" double precision,
	"note" text DEFAULT '' NOT NULL,
	"seq" integer,
	"source" "holding_event_source" DEFAULT 'import' NOT NULL,
	"sip_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holding_valuations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"holding_id" uuid NOT NULL,
	"date" date NOT NULL,
	"value_paise" bigint NOT NULL,
	"nav" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"mapping" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"row_index" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"date" date,
	"amount_paise" bigint,
	"merchant" text DEFAULT '' NOT NULL,
	"raw_merchant" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"category_id" uuid,
	"dedupe_hash" text,
	"duplicate" boolean DEFAULT false NOT NULL,
	"include" boolean DEFAULT true NOT NULL,
	"error" text,
	"transaction_id" uuid,
	"reconciled_from" jsonb
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"status" "import_status" DEFAULT 'staged' NOT NULL,
	"mapping" jsonb,
	"headers" text[] DEFAULT '{}'::text[] NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"committed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insurance_health_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"stored_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailbox_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "mailbox_provider" NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_enc" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"match" text NOT NULL,
	"replacement" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "net_worth_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"assets_paise" bigint NOT NULL,
	"liabilities_paise" bigint NOT NULL,
	"breakdown" jsonb,
	"estimated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_prefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"account_id" uuid,
	"enabled" boolean DEFAULT true NOT NULL,
	"threshold_paise" bigint,
	"lead_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"data" jsonb,
	"read_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nps_details" (
	"holding_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"pran" text DEFAULT '' NOT NULL,
	"tier" "nps_tier" DEFAULT 'tier_i' NOT NULL,
	"equity_pct" integer DEFAULT 0 NOT NULL,
	"corporate_pct" integer DEFAULT 0 NOT NULL,
	"govt_pct" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "overdraft_details" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"sanctioned_limit_paise" bigint DEFAULT 0 NOT NULL,
	"annual_rate_bps" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projection_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"equity_return_bps" integer DEFAULT 1200 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retirement_details" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"annual_rate_bps" integer DEFAULT 0 NOT NULL,
	"maturity_date" date,
	"reference_number" text DEFAULT '' NOT NULL,
	"eps_balance_paise" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reward_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"date" date NOT NULL,
	"points" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"ingestion_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_dismissals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"merchant" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"url" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"date_of_birth" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"due_date" date,
	"completed_at" timestamp with time zone,
	"transaction_id" uuid,
	"source" text DEFAULT 'user' NOT NULL,
	"source_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_tasks_source_check" CHECK ("user_tasks"."source" in ('user', 'card-due'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "category_kind" NOT NULL,
	"necessity" "expense_necessity",
	"parent_id" uuid,
	"icon" text DEFAULT '' NOT NULL,
	"color" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_necessity_expense_only" CHECK ("categories"."necessity" is null or "categories"."kind" = 'expense')
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "goal_type" DEFAULT 'savings' NOT NULL,
	"target_paise" bigint,
	"target_months" integer,
	"target_date" date,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
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
CREATE TABLE "resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "resource_kind" NOT NULL,
	"name" text NOT NULL,
	"identifier" text DEFAULT '' NOT NULL,
	"provider" text DEFAULT '' NOT NULL,
	"plan_name" text DEFAULT '' NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "account_type" NOT NULL,
	"institution" text,
	"account_last4" text,
	"holder_name" text,
	"upi_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"opening_balance_paise" bigint DEFAULT 0 NOT NULL,
	"goal_id" uuid,
	"linked_account_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"system_kind" "account_system_kind",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "recurring_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"category_id" uuid,
	"merchant" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"frequency" "recurring_frequency" NOT NULL,
	"interval" integer DEFAULT 1 NOT NULL,
	"next_due_date" date NOT NULL,
	"end_date" date,
	"paused_at" timestamp with time zone,
	"kind" "recurring_kind" DEFAULT 'none' NOT NULL,
	"remind_days" integer,
	"resource_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holdings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"asset_class" "asset_class" NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"target_pct" integer,
	"amfi_scheme_code" integer,
	"folio_number" text,
	"grandfather_nav_paise" bigint,
	"gains_tax_class" "gains_tax_class" DEFAULT 'equity' NOT NULL,
	"goal_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insurance_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "insurance_kind" DEFAULT 'life' NOT NULL,
	"vehicle_type" "vehicle_kind",
	"vehicle_reg_no" text DEFAULT '' NOT NULL,
	"resource_id" uuid,
	"health_type" "health_type",
	"insurer" text DEFAULT '' NOT NULL,
	"policy_number" text DEFAULT '' NOT NULL,
	"policy_wording_url" text DEFAULT '' NOT NULL,
	"sum_assured_paise" bigint DEFAULT 0 NOT NULL,
	"bonus_paise" bigint DEFAULT 0 NOT NULL,
	"premium_paise" bigint DEFAULT 0 NOT NULL,
	"premium_frequency" "premium_frequency" DEFAULT 'yearly' NOT NULL,
	"start_date" date,
	"renewal_date" date,
	"maturity_date" date,
	"nominee" text DEFAULT '' NOT NULL,
	"covered_members" text[] DEFAULT '{}'::text[] NOT NULL,
	"document_path" text,
	"document_name" text,
	"document_mime" text,
	"document_size_bytes" integer,
	"notes" text DEFAULT '' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"source_account_id" uuid NOT NULL,
	"target_kind" "sip_target_kind" NOT NULL,
	"target_holding_id" uuid,
	"target_account_id" uuid,
	"amount_paise" bigint NOT NULL,
	"day_of_month" integer NOT NULL,
	"frequency" "sip_frequency" DEFAULT 'monthly' NOT NULL,
	"status" "sip_status" DEFAULT 'active' NOT NULL,
	"funding_source" "sip_funding_source" DEFAULT 'bank_debit' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sips_payroll_requires_account_target" CHECK ("sips"."funding_source" <> 'payroll' or "sips"."target_kind" = 'account')
);
--> statement-breakpoint
CREATE TABLE "statement_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"period" text NOT NULL,
	"statement_date" date,
	"ingestion_id" uuid,
	"total_due_paise" bigint,
	"min_due_paise" bigint,
	"reward_opening" integer,
	"reward_earned" integer,
	"reward_redeemed" integer,
	"reward_closing" integer,
	"line_count" integer DEFAULT 0 NOT NULL,
	"line_debit_paise" bigint DEFAULT 0 NOT NULL,
	"matched_count" integer DEFAULT 0 NOT NULL,
	"matched_paise" bigint DEFAULT 0 NOT NULL,
	"unmatched_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "postings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"category_id" uuid,
	"amount_paise" bigint NOT NULL,
	"necessity" "expense_necessity",
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"occurred_at" timestamp with time zone,
	"merchant" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"source" "transaction_source" DEFAULT 'manual' NOT NULL,
	"policy_id" uuid,
	"resource_id" uuid,
	"sip_id" uuid,
	"recurring_template_id" uuid,
	"reconciled_statement_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_nps_details" ADD CONSTRAINT "account_nps_details_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_nps_details" ADD CONSTRAINT "account_nps_details_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_events" ADD CONSTRAINT "ai_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_events" ADD CONSTRAINT "ai_events_ingestion_id_email_ingestions_id_fk" FOREIGN KEY ("ingestion_id") REFERENCES "public"."email_ingestions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_events" ADD CONSTRAINT "ai_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_ledger" ADD CONSTRAINT "alert_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_details" ADD CONSTRAINT "bank_details_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_details" ADD CONSTRAINT "bank_details_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_alerts" ADD CONSTRAINT "budget_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_alerts" ADD CONSTRAINT "budget_alerts_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_details" ADD CONSTRAINT "card_details_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_details" ADD CONSTRAINT "card_details_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_issuer_settings" ADD CONSTRAINT "card_issuer_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_statements" ADD CONSTRAINT "card_statements_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_statements" ADD CONSTRAINT "card_statements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emi_details" ADD CONSTRAINT "emi_details_template_id_recurring_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."recurring_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emi_details" ADD CONSTRAINT "emi_details_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emi_details" ADD CONSTRAINT "emi_details_loan_account_id_accounts_id_fk" FOREIGN KEY ("loan_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracted_transactions" ADD CONSTRAINT "extracted_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracted_transactions" ADD CONSTRAINT "extracted_transactions_ingestion_id_email_ingestions_id_fk" FOREIGN KEY ("ingestion_id") REFERENCES "public"."email_ingestions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracted_transactions" ADD CONSTRAINT "extracted_transactions_suggested_account_id_accounts_id_fk" FOREIGN KEY ("suggested_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracted_transactions" ADD CONSTRAINT "extracted_transactions_suggested_category_id_categories_id_fk" FOREIGN KEY ("suggested_category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracted_transactions" ADD CONSTRAINT "extracted_transactions_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracted_transactions" ADD CONSTRAINT "extracted_transactions_matched_transaction_id_transactions_id_fk" FOREIGN KEY ("matched_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_details" ADD CONSTRAINT "gold_details_holding_id_holdings_id_fk" FOREIGN KEY ("holding_id") REFERENCES "public"."holdings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_details" ADD CONSTRAINT "gold_details_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding_events" ADD CONSTRAINT "holding_events_holding_id_holdings_id_fk" FOREIGN KEY ("holding_id") REFERENCES "public"."holdings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding_events" ADD CONSTRAINT "holding_events_sip_id_sips_id_fk" FOREIGN KEY ("sip_id") REFERENCES "public"."sips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding_valuations" ADD CONSTRAINT "holding_valuations_holding_id_holdings_id_fk" FOREIGN KEY ("holding_id") REFERENCES "public"."holdings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_presets" ADD CONSTRAINT "import_presets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_presets" ADD CONSTRAINT "import_presets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_health_cards" ADD CONSTRAINT "insurance_health_cards_policy_id_insurance_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."insurance_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_health_cards" ADD CONSTRAINT "insurance_health_cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_credentials" ADD CONSTRAINT "mailbox_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_rules" ADD CONSTRAINT "merchant_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "net_worth_snapshots" ADD CONSTRAINT "net_worth_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nps_details" ADD CONSTRAINT "nps_details_holding_id_holdings_id_fk" FOREIGN KEY ("holding_id") REFERENCES "public"."holdings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nps_details" ADD CONSTRAINT "nps_details_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overdraft_details" ADD CONSTRAINT "overdraft_details_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overdraft_details" ADD CONSTRAINT "overdraft_details_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projection_settings" ADD CONSTRAINT "projection_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retirement_details" ADD CONSTRAINT "retirement_details_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retirement_details" ADD CONSTRAINT "retirement_details_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_entries" ADD CONSTRAINT "reward_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_entries" ADD CONSTRAINT "reward_entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_entries" ADD CONSTRAINT "reward_entries_ingestion_id_email_ingestions_id_fk" FOREIGN KEY ("ingestion_id") REFERENCES "public"."email_ingestions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_dismissals" ADD CONSTRAINT "subscription_dismissals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_links" ADD CONSTRAINT "transaction_links_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tasks" ADD CONSTRAINT "user_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tasks" ADD CONSTRAINT "user_tasks_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_accounts" ADD CONSTRAINT "mailbox_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_linked_account_id_accounts_id_fk" FOREIGN KEY ("linked_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_ingestions" ADD CONSTRAINT "email_ingestions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_ingestions" ADD CONSTRAINT "email_ingestions_mailbox_id_mailbox_accounts_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailbox_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_templates" ADD CONSTRAINT "recurring_templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_templates" ADD CONSTRAINT "recurring_templates_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_templates" ADD CONSTRAINT "recurring_templates_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_templates" ADD CONSTRAINT "recurring_templates_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sips" ADD CONSTRAINT "sips_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sips" ADD CONSTRAINT "sips_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sips" ADD CONSTRAINT "sips_source_account_id_accounts_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sips" ADD CONSTRAINT "sips_target_holding_id_holdings_id_fk" FOREIGN KEY ("target_holding_id") REFERENCES "public"."holdings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sips" ADD CONSTRAINT "sips_target_account_id_accounts_id_fk" FOREIGN KEY ("target_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_reconciliations" ADD CONSTRAINT "statement_reconciliations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_reconciliations" ADD CONSTRAINT "statement_reconciliations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_reconciliations" ADD CONSTRAINT "statement_reconciliations_ingestion_id_email_ingestions_id_fk" FOREIGN KEY ("ingestion_id") REFERENCES "public"."email_ingestions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postings" ADD CONSTRAINT "postings_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postings" ADD CONSTRAINT "postings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postings" ADD CONSTRAINT "postings_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_policy_id_insurance_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."insurance_policies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_sip_id_sips_id_fk" FOREIGN KEY ("sip_id") REFERENCES "public"."sips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_template_id_recurring_templates_id_fk" FOREIGN KEY ("recurring_template_id") REFERENCES "public"."recurring_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_reconciled_statement_id_statement_reconciliations_id_fk" FOREIGN KEY ("reconciled_statement_id") REFERENCES "public"."statement_reconciliations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_events_user_created_idx" ON "ai_events" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "alert_ledger_unique_idx" ON "alert_ledger" USING btree ("user_id","kind","ref_key");--> statement-breakpoint
CREATE INDEX "attachments_tx_idx" ON "attachments" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_alerts_unique_idx" ON "budget_alerts" USING btree ("user_id","period_key","category_id","threshold");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_lines_budget_category_idx" ON "budget_lines" USING btree ("budget_id","category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_user_period_idx" ON "budgets" USING btree ("user_id","period","period_key");--> statement-breakpoint
CREATE INDEX "card_statements_account_idx" ON "card_statements" USING btree ("account_id","period");--> statement-breakpoint
CREATE INDEX "extracted_transactions_status_idx" ON "extracted_transactions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "extracted_transactions_ingestion_idx" ON "extracted_transactions" USING btree ("ingestion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "extracted_transactions_dedupe_idx" ON "extracted_transactions" USING btree ("user_id","dedupe_hash");--> statement-breakpoint
CREATE INDEX "family_members_user_idx" ON "family_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "holding_events_holding_idx" ON "holding_events" USING btree ("holding_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "holding_events_sip_date_idx" ON "holding_events" USING btree ("sip_id","date") WHERE sip_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "holding_valuations_unique_idx" ON "holding_valuations" USING btree ("holding_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "import_presets_account_idx" ON "import_presets" USING btree ("user_id","account_id");--> statement-breakpoint
CREATE INDEX "import_rows_import_idx" ON "import_rows" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "import_rows_hash_idx" ON "import_rows" USING btree ("dedupe_hash");--> statement-breakpoint
CREATE INDEX "imports_user_idx" ON "imports" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "insurance_health_cards_policy_idx" ON "insurance_health_cards" USING btree ("policy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mailbox_credentials_user_provider_idx" ON "mailbox_credentials" USING btree ("user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_rules_user_match_idx" ON "merchant_rules" USING btree ("user_id","match");--> statement-breakpoint
CREATE UNIQUE INDEX "net_worth_snapshots_unique_idx" ON "net_worth_snapshots" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "notification_prefs_user_idx" ON "notification_prefs" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reward_entries_account_idx" ON "reward_entries" USING btree ("account_id","date");--> statement-breakpoint
CREATE INDEX "reward_entries_ingestion_idx" ON "reward_entries" USING btree ("ingestion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_dismissals_unique_idx" ON "subscription_dismissals" USING btree ("user_id","merchant");--> statement-breakpoint
CREATE INDEX "transaction_links_tx_idx" ON "transaction_links" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "user_tasks_user_idx" ON "user_tasks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_tasks_transaction_idx" ON "user_tasks" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_tasks_source_key_idx" ON "user_tasks" USING btree ("user_id","source_key") WHERE "user_tasks"."source_key" is not null;--> statement-breakpoint
CREATE INDEX "categories_user_idx" ON "categories" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_user_name_parent_idx" ON "categories" USING btree ("user_id","name","parent_id");--> statement-breakpoint
CREATE INDEX "goals_user_idx" ON "goals" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mailbox_accounts_addr_idx" ON "mailbox_accounts" USING btree ("user_id","email_address");--> statement-breakpoint
CREATE INDEX "resources_user_kind_idx" ON "resources" USING btree ("user_id","kind","name");--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_system_kind_idx" ON "accounts" USING btree ("user_id","system_kind") WHERE system_kind is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "email_ingestions_msgid_idx" ON "email_ingestions" USING btree ("user_id","message_id");--> statement-breakpoint
CREATE INDEX "email_ingestions_status_idx" ON "email_ingestions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "recurring_templates_user_idx" ON "recurring_templates" USING btree ("user_id","next_due_date");--> statement-breakpoint
CREATE INDEX "holdings_user_idx" ON "holdings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "insurance_policies_user_idx" ON "insurance_policies" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sips_user_idx" ON "sips" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sips_goal_idx" ON "sips" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "sips_source_account_idx" ON "sips" USING btree ("source_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "statement_reconciliations_cycle_idx" ON "statement_reconciliations" USING btree ("account_id","period");--> statement-breakpoint
CREATE INDEX "statement_reconciliations_user_idx" ON "statement_reconciliations" USING btree ("user_id","account_id");--> statement-breakpoint
CREATE INDEX "postings_tx_idx" ON "postings" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "postings_account_idx" ON "postings" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "postings_category_idx" ON "postings" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "transactions_user_date_idx" ON "transactions" USING btree ("user_id","date" DESC NULLS LAST,"created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_policy_idx" ON "transactions" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "transactions_resource_idx" ON "transactions" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "transactions_recurring_template_idx" ON "transactions" USING btree ("recurring_template_id");--> statement-breakpoint
CREATE INDEX "transactions_reconciled_idx" ON "transactions" USING btree ("reconciled_statement_id");
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "search" tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce("merchant", '') || ' ' || coalesce("notes", ''))) STORED;
--> statement-breakpoint
CREATE INDEX "transactions_search_idx" ON "transactions" USING gin ("search");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_sip_date_idx" ON "transactions" USING btree ("sip_id","date") WHERE sip_id is not null and deleted_at is null;