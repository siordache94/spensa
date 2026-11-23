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

Planned meals are ordered by their date. A snapshot covers every planned meal on or before its date.

### Ordering

Batches and adjustments are ordered by when the server recorded them (`recorded_at`, set by a database trigger, never by the client). One is after a snapshot only if `recorded_at > snapshot.taken_at`. The phone's own time (`added_at`, adjustments' `at`) is for display only: it can be hours stale after offline use or simply wrong, and would wrongly place a synced batch before a snapshot saved meanwhile, losing its stock.

Equality counts as covered. `finish_shopping` writes the snapshot in one transaction with the batches it covers, so they share `now()` and the snapshot already lists them. Days are derived from `recorded_at` in the household timezone (`addedOn`, adjustment `on`), never from the phone's clock.

### Shopping trip

The shopping list is the replay's shortfalls over the trip's range (today through the household horizon), restricted to meals not flagged `skip_shopping`. The flag never changes the replay: a skipped meal is still planned and eaten, so it still consumes stock. It only drops that meal's needs from the list.

## Consequences

- Editing any day after the latest snapshot just changes the replay result. No cron, no write races.
- Edits before the latest snapshot have no effect on stock. That is intended: the snapshot is what you counted.
- The replay cost grows with events since the last snapshot. For two people this is small, and every inventory check resets it.
- The logic lives in one tested module rather than being spread across SQL and UI.
