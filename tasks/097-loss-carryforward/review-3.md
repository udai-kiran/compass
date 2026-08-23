Not implementation-ready. The review-2 direction is mostly recorded correctly, but several blockers remain in the task specification. No implementation exists yet to verify.

## High

- **The authoritative service specification still contradicts the recorded fixes.** The implementation section still calls `computeSetOff()` “tax-minimizing,” includes the prohibited BF-allocation step in materialization, references nonexistent `target_fy`, uses removed `itr_filed`/`filed_within_due_date` fields, and describes loading only target-FY allocations. These conflict with the corrected policy, schema, and all-prior-FY availability rules in the preamble. An implementer following this section could recreate review-2 defects. Update [TASK.md](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:83), especially lines 83 and 95–107, to be the canonical corrected algorithm.

- **`loss_declared_in_itr` cannot be set through any planned route.** Materialization always creates an undeclared estimate, while AC3 permits BFLA only from declared records. The statement that users may replace balances after filing is likewise unsupported by the five planned endpoints. Consequently, no portfolio-derived record can become eligible for carry-forward through the API. Add a user-scoped create/update/declaration operation that atomically stores the filed STCL/LTCL balances, sets `source="user_filed"` and `loss_declared_in_itr=true`, derives `expires_fy`, and refuses changes once allocations exist. The confirm-set-off endpoint should reject undeclared source records.

- **The materialization guard is not specified atomically.** `confirmSetOff()` locks the parent row, but `materializeCurrentFy()` is only described as checking guards and then upserting. A concurrent confirmation can occur between that check and update, allowing materialization to rewrite balances beneath a confirmed allocation. Materialization must use the same transaction and row lock—or an equivalent atomic conditional write—before checking declaration/allocation guards and updating the record.

## Medium

- **Availability has three distinct meanings that remain conflated.** Advisory opening availability for FY `F` should subtract allocations with `setoff_fy < F`; confirmation-time conservation must subtract all existing allocations regardless of FY; present-day/list availability may also need all allocations. The list route merely says “stored minus confirmed allocations,” while the preamble and schema comment express different scopes. Specify each calculation explicitly, including behavior when confirmations are entered out of chronological order.

- **Dated simulation conflicts with the “use confirmed target FY exactly” rule.** A finalized annual allocation has no realization date, so it cannot safely be attributed to a June, September, or December cutoff. Applying the full stored allocation could offset gains that had not yet arisen; re-simulating would violate the exact-allocation requirement. State that exact stored target-FY allocations apply only to annual summaries, or define a conservative dated treatment and expose its limitation.

- **The verification plan omits tests for the most important persistence guarantees.** P7 should include a real-database concurrent-insert test proving the parent lock prevents competing over-allocation, a materialize-versus-confirm race test, and integration tests proving both advisory endpoints leave allocation row counts unchanged. It should also test that confirmed target-FY rows are applied exactly without a second simulated allocation.

- **The estimate/authoritative response contract is unspecified.** The task says consumers must label derived availability as an estimate, but no shared response shape or required field defines this. Specify an `isEstimate`, `source`, or equivalent field for list, annual summary, and dated simulation responses.

- **Cutoff validation is incomplete.** `simulation-as-of` should validate that `cutoff` is a real ISO date within the requested FY. Otherwise a cutoff in another FY can silently produce an empty or effectively annual result.

## Low

- **Obsolete allocation names remain in the availability formula.** `stcl_used_paise` and `ltcl_used_paise` no longer exist after introducing destination breakdown columns. Define STCL usage as `stcl_to_stcg_paise + stcl_to_ltcg_paise` and LTCL usage as `ltcl_to_ltcg_paise` in [TASK.md](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:14).

- **The `source` domain is only documented in a comment.** Prefer a constrained enum/check or explicitly require service-level validation so values other than `derived_from_portfolio` and `user_filed` cannot enter the table.

The breakdown-column schema, removal of child `user_id`, inclusive server-derived expiry, per-type BF ordering, advisory-only allocation persistence, and `lossUsed` input requirements are otherwise recorded correctly.