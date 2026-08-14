# Task: 035 — investments StatTile font size

## Status
COMPLETE

## Objective
Large INR numbers (e.g. ₹92,46,409.62) in the five StatTile cards on the
Investments page cramp the tile at `text-2xl` (24 px). Reduce to `text-xl`
(20 px) so numbers fit with visible breathing room.

## Root Cause
`StatTile` in `apps/web/src/lib/viz.tsx` (line 393) uses `text-2xl` for the
value `<p>`. At `lg:grid-cols-5` inside `max-w-5xl`, each tile is ~160 px
usable width — a 12-char INR string at 24 px is tight.

## Scope
- `apps/web/src/lib/viz.tsx` — StatTile value paragraph only

## Dependencies
none

## Plan
- P1: Change `text-2xl` → `text-xl` on the value `<p>` in StatTile (line 393)

## Acceptance Criteria
- AC1: `StatTile` value `<p>` has class `text-xl` (not `text-2xl`)
- AC2: No other StatTile layout changed

## Non-Goals
- Changing HoldingRow number sizing
- Responsive clamp or JS-based text fitting
