-- Full-text search: generated tsvector over merchant + notes, GIN indexed.
ALTER TABLE "transactions" ADD COLUMN "search" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce("merchant", '') || ' ' || coalesce("notes", ''))) STORED;
--> statement-breakpoint
CREATE INDEX "transactions_search_idx" ON "transactions" USING gin ("search");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION check_split_sum() RETURNS trigger AS $$
DECLARE
  tx_id uuid;
  parent_amount bigint;
  split_total bigint;
  split_count int;
BEGIN
  IF TG_TABLE_NAME = 'transaction_splits' THEN
    tx_id := COALESCE(NEW.transaction_id, OLD.transaction_id);
  ELSE
    tx_id := NEW.id;
  END IF;
  SELECT amount_paise INTO parent_amount FROM transactions WHERE id = tx_id;
  IF parent_amount IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT coalesce(sum(amount_paise), 0), count(*) INTO split_total, split_count
    FROM transaction_splits WHERE transaction_id = tx_id;
  IF split_count > 0 AND split_total <> parent_amount THEN
    RAISE EXCEPTION 'splits (%) must sum to transaction amount (%)', split_total, parent_amount;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER transaction_splits_sum_check
  AFTER INSERT OR UPDATE OR DELETE ON "transaction_splits"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_split_sum();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER transactions_amount_split_check
  AFTER UPDATE OF "amount_paise" ON "transactions"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_split_sum();
