CREATE TYPE "public"."regime_source" AS ENUM('chosen', 'inferred', 'default');--> statement-breakpoint
ALTER TABLE "tax_regime_preferences" ALTER COLUMN "chosen" SET DATA TYPE "public"."tax_regime" USING "chosen"::"public"."tax_regime";--> statement-breakpoint
ALTER TABLE "tax_regime_preferences" ALTER COLUMN "inferred_regime" SET DATA TYPE "public"."tax_regime" USING "inferred_regime"::"public"."tax_regime";--> statement-breakpoint
ALTER TABLE "tax_regime_preferences" ALTER COLUMN "effective" SET DATA TYPE "public"."tax_regime" USING "effective"::"public"."tax_regime";--> statement-breakpoint
ALTER TABLE "tax_regime_preferences" ALTER COLUMN "source" SET DATA TYPE "public"."regime_source" USING "source"::"public"."regime_source";