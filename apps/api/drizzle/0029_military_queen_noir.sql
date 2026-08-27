CREATE TABLE "vehicle_details" (
	"resource_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"service_interval_km" integer,
	"service_interval_months" integer,
	"last_service_odometer_km" integer,
	"last_service_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_odometer_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"odometer_km" integer NOT NULL,
	"reading_date" date NOT NULL,
	"transaction_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_odometer_readings_km_check" CHECK ("vehicle_odometer_readings"."odometer_km" >= 0)
);
--> statement-breakpoint
ALTER TABLE "user_tasks" DROP CONSTRAINT "user_tasks_source_check";--> statement-breakpoint
ALTER TABLE "vehicle_details" ADD CONSTRAINT "vehicle_details_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_details" ADD CONSTRAINT "vehicle_details_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_odometer_readings" ADD CONSTRAINT "vehicle_odometer_readings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_odometer_readings" ADD CONSTRAINT "vehicle_odometer_readings_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_odometer_readings" ADD CONSTRAINT "vehicle_odometer_readings_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vehicle_odometer_readings_resource_idx" ON "vehicle_odometer_readings" USING btree ("resource_id","reading_date");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_odometer_readings_txn_idx" ON "vehicle_odometer_readings" USING btree ("transaction_id") WHERE "vehicle_odometer_readings"."transaction_id" is not null;--> statement-breakpoint
ALTER TABLE "user_tasks" ADD CONSTRAINT "user_tasks_source_check" CHECK ("user_tasks"."source" in ('user', 'card-due', 'vehicle-service'));