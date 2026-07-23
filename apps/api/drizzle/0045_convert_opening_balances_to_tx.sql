-- Move existing bank/cash opening balances onto the ledger as real "Opening
-- balance" transactions (is_opening = true, dated at account creation), so the
-- account ledger reconciles instead of a balance appearing from a hidden column.
-- Then zero the column so no balance surface double-counts: every balance is
-- opening_balance_paise + SUM(transactions) = 0 + SUM(transactions).
--
-- Scoped to bank/cash only — cards/loans/schemes keep their opening balance on
-- the column, which their statement/valuation logic reads directly. is_opening
-- (added in 0044) is excluded from income/expense/spend aggregations like a transfer.

INSERT INTO transactions (user_id, account_id, date, amount_paise, merchant, is_opening)
SELECT a.user_id, a.id, a.created_at::date, a.opening_balance_paise, 'Opening balance', true
FROM accounts a
WHERE a.type IN ('bank', 'cash') AND a.opening_balance_paise <> 0;
--> statement-breakpoint
UPDATE accounts
SET opening_balance_paise = 0, updated_at = now()
WHERE type IN ('bank', 'cash') AND opening_balance_paise <> 0;
