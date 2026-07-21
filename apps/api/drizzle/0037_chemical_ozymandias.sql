ALTER TABLE "card_details" ADD COLUMN "statement_password_enc" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Preserve any password stored at the issuer level (0034 moved it up) by copying
-- it down to each of that bank's cards. It's already encrypted, so this is a
-- straight value copy. It stays correct for the one card it was meant for; the
-- others now carry the same value and can be re-entered per card (HDFC and others
-- embed the card's own last-4, so one bank's cards each need their own).
UPDATE "card_details" cd
SET "statement_password_enc" = cis."statement_password_enc"
FROM "accounts" a
JOIN "card_issuer_settings" cis
  ON cis."user_id" = a."user_id" AND cis."institution" = a."institution"
WHERE cd."account_id" = a."id"
  AND cis."statement_password_enc" <> '';--> statement-breakpoint
ALTER TABLE "card_issuer_settings" DROP COLUMN "statement_password_enc";
