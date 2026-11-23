# 0001: Compute stock by replaying events

## Status

Accepted, 2026-11-23.

## Context

Planned meals count as eaten on their date, and past days can be edited. If deductions were written to the database when a day passed, every edit to a past day would have to undo and redo them. Two phones could also write the same deduction twice.

## Decision

Store only facts: batches, planned meals, adjustments and snapshots. Never store derived stock.

One pure TypeScript module (`src/domain/replay.ts`) computes current stock, projected stock, shortfalls, expiring-soon batches and the shopping list:

1. Start from the latest snapshot (or empty).
2. Walk the days in order. Within a day, apply new batches first, then planned meals, then adjustments.
3. A planned meal takes `portions × qty_per_portion` from unexpired batches, soonest expiry first (no expiry = last). What it can't cover is a shortfall. Stock never goes negative.

Batches and adjustments are ordered by their timestamp, planned meals by their date. A snapshot covers every event at or before its timestamp, and every planned meal on or before its date.

## Consequences

- Editing any day after the latest snapshot just changes the replay result. No cron, no write races.
- Edits before the latest snapshot have no effect on stock. That is intended: the snapshot is what you counted.
- The replay cost grows with events since the last snapshot. For two people this is small, and every inventory check resets it.
- The logic lives in one tested module rather than being spread across SQL and UI.
