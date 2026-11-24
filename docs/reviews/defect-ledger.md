# Zero-known-bugs ledger

The two-phone week is the release signal. It must start with **no known defects**.

**Status: empty.** All 44 review findings and follow-ups classified as `defect`, `gap` or `hygiene` are fixed and
verified. 9 architecture findings remain as accepted risk; they are not defects.

## Verification at ledger-empty

- `npm test`: 41 files, **443 tests passed**
- `npx tsc -b --noEmit`: clean
- `npm run lint`: 0 errors, 7 warnings (Fast Refresh advisories plus the Pantry draft-restore effect)
- `npm run build`: passes
- `npm run check:functions`: 5/5 edge functions clean
- SQL: `rls_smoke`, `rpc_smoke`, `checkin_smoke`, `gdpr_smoke`, `push_smoke` all pass
- Contract suite: the same assertions run against the fake and the real local Supabase adapter
- Migrations applied locally through `20261128140000_integrity_fixes.sql`

## Closed in this pass

| Area | Findings |
|---|---|
| Shop and trip | MR-001, MR-003, MR-004, MR-005, MR-018, MR-029, MR-031, MR-042, MR-043, MR-044, MR-053 |
| Recipe and plan | MR-016, MR-017, MR-030, MR-033, MR-036, MR-037 |
| Pantry | MR-013, MR-019, MR-032, MR-045 |
| Auth and account | MR-015, MR-039 |
| Session and offline | MR-007, MR-008 |
| Timezone and dates | MR-006, MR-035 |
| Data integrity | MR-046, MR-052 |
| Shell, settings, copy | MR-010, MR-011, MR-012, MR-014, MR-034, MR-038, MR-040, MR-041, MR-049, MR-050 |
| Test seams | MR-009, MR-048 |
| Reminders | MR-028 |
| CORS | MR-002 |

## Accepted risk (not defects)

| ID | Risk |
|---|---|
| MR-020 | Trip stock recomputed per screen; rules duplicated in render code |
| MR-021 | Shop page owns collaboration logic that no page test renders |
| MR-022 | `['pantry']` cache value is an unnamed structural type with three writers |
| MR-023 | Household row read through three keys; five refresh helpers |
| MR-024 | Domain imports the port and database row types (type-level cycle) |
| MR-025 | DataPort has ~56 methods and speaks persistence; planned-meal shape declared five times |
| MR-026 | Check-in compound write lives in a dialog |
| MR-027 | Household fact loader implemented twice (client and edge) |
| MR-047 | Trip rules split; device ack state in the same module as pure rules |

Revisit after the phone week. None of these currently produces wrong behaviour.

## Still manual (not code)

- Two-phone week: plan, shop with an offline segment, finish, correct reality, no lost or duplicated stock.
- Installed-PWA checks: focus rings, 44px targets, safe-area insets, 320/360px, Android back, iOS home indicator.
- Deployment: push VAPID, check-in cron, delete-account in production, published privacy URL, rollback verified.
