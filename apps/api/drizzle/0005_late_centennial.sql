CREATE TYPE "public"."cart_draft_status" AS ENUM('draft', 'ordered', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."normalized_unit" AS ENUM('g', 'ml', 'piece');--> statement-breakpoint
CREATE TYPE "public"."price_source_kind" AS ENUM('quick_commerce', 'ecommerce', 'local_store', 'manual');--> statement-breakpoint
CREATE TYPE "public"."shopping_list_item_status" AS ENUM('pending', 'bought', 'dropped');--> statement-breakpoint
CREATE TYPE "public"."shopping_list_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TABLE "cart_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "cart_draft_status" DEFAULT 'draft' NOT NULL,
	"price_source_id" uuid,
	"total_paise" bigint DEFAULT 0 NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cart_drafts_total_nonneg" CHECK ("total_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "catalog_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"canonical_name" text NOT NULL,
	"brand" text,
	"category_id" uuid,
	"pack_quantity_base" bigint,
	"unit" "normalized_unit",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_items_pack_quantity_nonneg" CHECK ("pack_quantity_base" IS NULL OR "pack_quantity_base" >= 0),
	CONSTRAINT "catalog_items_quantity_unit_paired" CHECK (("pack_quantity_base" IS NULL) = ("unit" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "habit_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"catalog_item_id" uuid NOT NULL,
	"consumption_base_per_month" bigint,
	"unit" "normalized_unit",
	"observation_count" integer DEFAULT 0 NOT NULL,
	"last_computed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "habit_profiles_consumption_nonneg" CHECK ("consumption_base_per_month" IS NULL OR "consumption_base_per_month" >= 0),
	CONSTRAINT "habit_profiles_consumption_unit_paired" CHECK (("consumption_base_per_month" IS NULL) = ("unit" IS NULL)),
	CONSTRAINT "habit_profiles_observation_count_nonneg" CHECK ("observation_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pantry_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"catalog_item_id" uuid NOT NULL,
	"quantity_base" bigint,
	"unit" "normalized_unit",
	"last_purchased_at" timestamp with time zone,
	"expected_depletion_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pantry_items_quantity_nonneg" CHECK ("quantity_base" IS NULL OR "quantity_base" >= 0),
	CONSTRAINT "pantry_items_quantity_unit_paired" CHECK (("quantity_base" IS NULL) = ("unit" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "price_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"catalog_item_id" uuid NOT NULL,
	"price_source_id" uuid NOT NULL,
	"price_paise" bigint NOT NULL,
	"mrp_paise" bigint,
	"pack_quantity_base" bigint,
	"unit" "normalized_unit",
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_observations_price_nonneg" CHECK ("price_paise" >= 0),
	CONSTRAINT "price_observations_mrp_nonneg" CHECK ("mrp_paise" IS NULL OR "mrp_paise" >= 0),
	CONSTRAINT "price_observations_pack_quantity_nonneg" CHECK ("pack_quantity_base" IS NULL OR "pack_quantity_base" >= 0),
	CONSTRAINT "price_observations_quantity_unit_paired" CHECK (("pack_quantity_base" IS NULL) = ("unit" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "price_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "price_source_kind" NOT NULL,
	"url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopping_list_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"catalog_item_id" uuid,
	"raw_text" text NOT NULL,
	"quantity_base" bigint,
	"unit" "normalized_unit",
	"status" "shopping_list_item_status" DEFAULT 'pending' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shopping_list_items_quantity_nonneg" CHECK ("quantity_base" IS NULL OR "quantity_base" >= 0),
	CONSTRAINT "shopping_list_items_quantity_unit_paired" CHECK (("quantity_base" IS NULL) = ("unit" IS NULL)),
	CONSTRAINT "shopping_list_items_position_nonneg" CHECK ("position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "shopping_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "shopping_list_status" DEFAULT 'active' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cart_drafts" ADD CONSTRAINT "cart_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_drafts" ADD CONSTRAINT "cart_drafts_price_source_id_price_sources_id_fk" FOREIGN KEY ("price_source_id") REFERENCES "public"."price_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habit_profiles" ADD CONSTRAINT "habit_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habit_profiles" ADD CONSTRAINT "habit_profiles_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pantry_items" ADD CONSTRAINT "pantry_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pantry_items" ADD CONSTRAINT "pantry_items_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_price_source_id_price_sources_id_fk" FOREIGN KEY ("price_source_id") REFERENCES "public"."price_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_sources" ADD CONSTRAINT "price_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_list_id_shopping_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."shopping_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_lists" ADD CONSTRAINT "shopping_lists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cart_drafts_user_idx" ON "cart_drafts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_items_user_name_idx" ON "catalog_items" USING btree ("user_id","canonical_name");--> statement-breakpoint
CREATE UNIQUE INDEX "habit_profiles_user_item_idx" ON "habit_profiles" USING btree ("user_id","catalog_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pantry_items_user_item_idx" ON "pantry_items" USING btree ("user_id","catalog_item_id");--> statement-breakpoint
CREATE INDEX "price_observations_item_observed_idx" ON "price_observations" USING btree ("catalog_item_id","observed_at");--> statement-breakpoint
CREATE INDEX "price_observations_user_idx" ON "price_observations" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_sources_user_name_idx" ON "price_sources" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "shopping_list_items_list_idx" ON "shopping_list_items" USING btree ("list_id");--> statement-breakpoint
CREATE INDEX "shopping_lists_user_idx" ON "shopping_lists" USING btree ("user_id");