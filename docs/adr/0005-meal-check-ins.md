# 0005: Meal check-ins, "didn't cook" and per-meal amounts

## Status

Accepted, 2026-11-27. Builds on [0001](0001-stock-by-replay.md), [0003](0003-soft-delete-and-authorship.md) and [0004](0004-web-push.md).

## Context

Stock is replayed from the plan (ADR 0001), so a meal that was not cooked as planned makes the pantry drift: the app thinks the pasta was eaten. We want to ask, shortly after a meal's slot ends, whether it went as planned, but only when the answer matters (the replay found the meal short, so a plan the pantry could not cover is the likeliest to have changed), and without nagging: a question left unanswered must not pile up as notifications nor block anything.

## Decision

### Facts on the meal

- `planned_meals.not_cooked boolean` ("didn't cook"). The replay skips the meal entirely (`mealAmounts` in `src/domain/replay.ts`); it neither consumes stock nor can be short, and it is left off the shopping list's to-taste needs.
- `planned_meal_lines (planned_meal_id, ingredient_id, qty_total)`, soft-deleted with authorship like every household table (composite FKs, RLS, `household_events` signal, soft cascade from the meal and from the ingredient). **When a meal has live lines they replace the recipe's lines for that meal; with none it follows the recipe.** Replace, not "adjust the recipe's lines", so that adding an ingredient and leaving one out are both just "the full list of what was used", and the replay needs no merge rules. The UI seeds the lines from the recipe when the person first edits (`seedMealLines`). `qty_total` is an amount for the whole meal in the ingredient's unit, not per portion, because it records what was actually used and should not change if the portions are edited later; null = to taste. `save_meal_lines(meal, lines)` diffs like `save_recipe`; an empty array removes the override. The replay input and `fetchPantry` embed the live lines (`MealRow.planned_meal_lines`), the edge-function loader does the same, so phone and server agree.

### The check-in is its own table

`meal_checkins (planned_meal_id unique, answered_at, answered_by, answer)`, one row per meal, unread while `answered_at` is null. Columns on `planned_meals` were rejected: answering would count as editing the meal (`updated_by`), clients can write `planned_meals` freely under RLS so the unread state and its history could be forged or lost, and "send at most once" would need a second flag. As a table, `unique (planned_meal_id)` (it includes soft-deleted rows, so a meal deleted and restored is not announced again) is the once-per-meal guarantee and the insert is the lock: only the tick whose insert succeeds sends the push. Clients can only read it; creation is service-role (`checkin_create`), answering is `answer_checkin`, which checks the household. It is shared, not per person: either answer clears it for both, first answer wins (a later call returns false). Soft-deleting the meal soft-deletes its check-in and restoring brings it back.

Answers: `planned`; `changed` (the UI edited the meal's lines with ordinary writes and then marks it); `not_cooked` (flags the meal, also done by a trigger when anyone sets `not_cooked` by a plain update, so the Plan screen's toggle clears the check-in too); `dismissed`.

### When, for which meals, and who

`push-cron` (every 15 minutes, ADR 0004) visits every household that has a subscribed device or a meal planned within the last couple of days. It runs the shared replay (`loadHousehold`) and `dueCheckins` (`src/lib/checkin.ts`):

- a meal dated today or yesterday (yesterday so a slot ending near midnight still gets its check-in; nothing older, so enabling this never floods),
- whose due time has passed: **the slot's end time plus 30 minutes**, as wall clock in the household timezone, DST-safe (`zonedInstant`; in a repeated hour the first one, in a gap just after it),
- that the replay found short (any shortfall, any amount),
- planned before the due time (a meal added afterwards is a record of what happened),
- with no check-in yet.

The check-in row is created regardless of push settings or devices, so the unread item always appears in the app. Timing is the 15-minute tick: a check-in comes 30 to 45 minutes after the slot ends. The shortfall of a meal is evaluated by the replay up to today as a whole, so a lunch can look short because a dinner earlier in the list took the stock; the replay orders a day's meals as stored, not by slot. We accepted that for two people.

Slot end times are `households.slot_end_times jsonb`, keyed by slot name (`{"lunch": "14:00", "dinner": "21:30"}`), 'HH:MM', validated by a CHECK, in the household's column-level update grant. jsonb rather than a column per slot or a parallel array because slots are user-defined and reorderable (`slots text[]`), and a keyed object survives renames of other slots. A slot without an entry takes the default for its name (breakfast 10:00, lunch 14:00, dinner 21:30, snack 17:00) and any other name 21:30.

Recipients: the meal's cook; if there is none (or the cook left), every member; in both cases only those whose `push_prefs.meal_checkins` is on (default true, independent of the list-change and expiry switches).

### The push

`kind: 'checkin'`, text "Dinner: Pasta al pomodoro. Cooked as planned?", `silent: true` and no `vibrate` (the two cannot be combined), actions "Cooked as planned" and "Changed it", a per-meal `tag` and push `topic` (so several meals do not replace each other), TTL 6 hours, low urgency, and the household's unread count for the badge. Android Chrome honours `silent` and `actions`; iOS ignores both, so there it is an ordinary notification with no buttons. Accepted. A tap opens the Plan tab on the meal (`/?meal=<id>`).

### Answering from the notification, without a session

A service worker has no Supabase session. Options: (a) open the app with `?checkin=planned` and let it answer, (b) call an endpoint with a credential held by the worker. (a) is simplest but defeats the point of a button on a silent notification. We did (b) with a **signed token in the push payload** (`src/lib/checkinToken.ts`): `userId.expiry.HMAC-SHA256(derivedKey, userId.mealId.expiry)`, the key derived from `PUSH_WEBHOOK_SECRET` (no new secret to deploy). It is minted per recipient when the push is sent, travels inside the encrypted push payload (only that device can read it), is valid 30 days, and `checkin-answer` (a `verify_jwt = false` function, constant-time compare) accepts it for exactly one action: answer `planned` on that meal for that person, via the service-only `checkin_answer_as` (which also checks household membership). A leaked token can therefore do nothing worse than mark one check-in "cooked as planned". A real session was rejected: storing a refresh token in the worker, or the user's JWT in the payload, grants far more than this button needs. If the call fails (offline, expired, already answered and gone) the worker opens the app on the meal with `?checkin=planned`, which the app resolves with `answer_checkin`. "Changed it" opens the app with `?checkin=changed` (the person is about to edit the amounts; the app marks `changed` once they save). The function URL comes in the payload (`push_config.functions_url`, or the `CHECKIN_ANSWER_URL` secret when phones reach the functions elsewhere than the database does). There is no rate limit beyond the token being per meal and user.

### Unread and the badge

The unread list is the household's check-ins with `answered_at is null`; it has no cap and no expiry. The app icon badge is its count, set by the app (`useCheckinsSync`, `navigator.setAppBadge`, feature-detected) and by the worker when a check-in push arrives (the payload carries the count) and after "Cooked as planned" (the answer endpoint returns it). The badge is a convenience: where unsupported, the in-app unread list is the truth.

### Done shopping

`finish_shopping(on_date, batches, answers jsonb default '[]')`, one transaction: apply the per-meal `answers` from the finish dialog (`[{meal_id, answer: 'planned' | 'not_cooked'}]`, others refused), save the snapshot, clear the trip as before, then answer everything still unread as `planned`. Any failure rolls it all back. `not_cooked` answers change what the replay consumes, so the dialog should compute the snapshot quantities with them applied; note that meals dated on or before the snapshot date no longer affect stock at all (a snapshot is the truth, ADR 0001), so for those the answer is a record.

## Consequences

- One more table, one more function, one more table in the export and the soft-delete cascade; push, replay and signal infrastructure is reused.
- A person who never opens the app accumulates unread check-ins (as intended: no expiry) until the next "Done shopping" clears them as cooked as planned, which is the safe default for stock because that is what the plan assumed.
- The in-app unread appears within a 15-minute tick plus the realtime signal; pushes can lag the same way.
- `audit_update` no longer restores `updated_by` for admin sessions, which had made deleting an account that had edited anything fail on the `ON DELETE SET NULL` of `updated_by` (found while testing this change).
- The token mechanism is the only unauthenticated write path; it is limited to one idempotent, low-value action.
