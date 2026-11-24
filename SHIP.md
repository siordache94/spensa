# Ship Core — Core Loop v1: Trust & Hardening

**Status:** active

## Core promise

A two-person household can plan meals, derive pantry stock and shopping needs, shop together, and correct reality cheaply without manually maintaining stock.

## Core user

Two people sharing one household, planning at home and shopping on phones, sometimes simultaneously and sometimes with poor signal.

## Core loop

1. Add recipes and ingredients.
2. Plan meals for the week.
3. Replay stock and calculate shortfalls.
4. Shop from the computed list, including offline ticks.
5. Turn purchases into pantry batches.
6. Save the “Done shopping” snapshot.
7. Answer check-ins to correct meals that differed from plan.

## Success signal

Both people complete one real week on two phones, including an offline shopping segment and at least one reality correction, with no lost or duplicated stock and no developer intervention.

## Release gates

- [ ] The zero-known-bugs ledger is empty: no open finding classified `defect` or `gap`, and every `hygiene` item is fixed or explicitly accepted in writing (`docs/reviews/defect-ledger.md` replaces the review copy at ship time). Architecture findings are accepted risks, not gate items.
- [ ] The complete core loop passes on two phones.
- [ ] A held partner purchase can be acknowledged without changing stock; back navigation cannot discard an unsaved pantry draft.
- [x] Partner purchases survive stale-client snapshot saves.
- [ ] Concurrent purchases of one item stay linked: returning one keeps it bought; only returning the last puts it back on the list.
- [x] Snapshot completeness is validated or made safe server-side.
- [ ] Offline conflict behaviour is defined and tested for supported shopping ticks, including the offline session lifetime.
- [x] Household day boundaries use the configured household timezone, not the database default.
- [x] Confirm-email sign-up shows a check-your-email state with a resend path.
- [ ] Core surfaces meet the documented focus, 44px tap-target and destructive-contrast rules.
- [x] The test adapter matches production transaction behaviour or fails loudly.
- [ ] Push, check-in cron, and account-deletion functions work in production.
- [ ] The privacy notice is published and linked from Settings.
- [x] `npm test`, `npm run lint`, `npm run build`, and `npm run check:functions` pass.
- [x] Relevant Supabase smoke tests pass.
- [ ] Deployment, smoke testing, and rollback are verified.

## Appetite

One focused week. If a gate cannot fit, hold the release or cut optional scope; do not silently extend the deadline.

## Non-goals

- Smart capture: barcode, receipt OCR, voice, guided photos, natural-language entry.
- AI recipes, URL import, nutrition, and recipe photos.
- Insights, price tracking, and activity history.
- Partial trips, per-store checkout, and snoozing.
- Leftovers, linked meals, and expanded meal modelling.
- Multiple households, translations, and native apps.
- General offline editing beyond the supported shopping mutations.

## Accepted risks

- Nine architecture findings (MR-020 to MR-027, MR-047) are accepted as known risk for the phone week: duplicated trip rules, a Shop page that owns untested orchestration, an unnamed `['pantry']` cache value, restated invalidation, domain-to-port imports, an over-wide DataPort, a check-in write in a dialog, two household loaders, and split trip rules. None produces wrong behaviour today. See `docs/reviews/defect-ledger.md`.
- Shopping checkout remains global rather than partial or per-store.
- Pantry history may eventually need pagination; the current 1,000-row limit is accepted for the two-person household until real usage proves otherwise.
- One household per user, English-only UI, and metric-only quantities remain.
- Platform-specific push limitations remain, including iPhone Home Screen requirements.

## Tracker

- Configuration: `docs/agents/issue-tracker.md`
- Active release: `lane:blocker` + `lane:core`
- Parked improvements: `lane:later`
- Parked product bets: `lane:bet`

## Inputs

- `PRODUCT.md`
- `CONTEXT.md`
- `README.md`
- `docs/spensa-status-report.md`
- `docs/adr/`
