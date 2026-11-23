# 0004: Web push from edge functions, list changes found by replaying on the server

## Status

Accepted, 2026-11-26.

## Context

Two people share one list and one pantry. We want two notifications: "Anna changed the list: 2 added, 1 removed" for the other member (combined over 30 seconds), and one daily "Expiring: Milk tomorrow, Spinach in 2 days" at each person's chosen time. One phone is an Android, the other an iPhone (web push there needs the app installed to the Home Screen, iOS 16.4+).

The to-buy list and stock are not stored. They are computed on the phone by the replay (ADR 0001), so the server has no row that says "an item was added".

## Decision

### How the server learns what changed: run the replay in the edge function

The pure TypeScript domain (`src/domain/replay.ts`) imports cleanly in Deno, so the edge functions load the household's live rows with the service role and run the same code the phone runs (`toBuyKeys` in `src/domain/toBuy.ts`, rows to events in `src/domain/pantryRows.ts`, both now shared with `src/lib/pantry.ts`). The list is a set of keys (`need-<ingredient>`, `item-<shopping item>`), the very keys the Shop tab renders, and the diff and the wording are the in-app toast's `diffToBuy` / `changeMessage` (`src/lib/trip.ts`). Items that vanish because they were bought or marked on hand are not "removed" (`resolvedKeys`).

Counting row changes (`shopping_items` inserts, `skip_shopping` flips) was the cheaper option and was rejected: it misses what the replay does implicitly (a recipe edited, a meal moved into or out of the trip range, stock changing a need, a staple dropping below min stock), counts a meal that was skipped and unskipped as two changes, and would have needed its own definition of "removed" that could drift from the toast. Running the replay costs one extra load per change (a few thousand rows at most for two people) and gives the same answer as the screen. Because the service role bypasses RLS, the loader filters `deleted_at is null` on every table and embed itself (ADR 0003) and pages past PostgREST's 1000-row cap.

### Batching: a 30-second window held in the database

- `push_list_state` has one row per household: `known` (the to-buy keys at the last evaluation) and, while a window is open, `window_at`, `window_keys` (the baseline when it opened) and `window_authors`.
- Every household write already touches `household_events` (ADR 0003). A trigger on it calls the `push-list` edge function through `pg_net` (after commit, fire and forget), but only when no window is open; while one is open it just records the writer in SQL, so a burst of edits costs one HTTP call.
- `push-list` computes the keys now and calls `push_list_observe`. A change that did not touch the list (a recipe name, a pantry edit that changes no need) leaves `known` equal and does nothing. The first change that does opens the window, with the pre-change `known` as the baseline, and the function keeps its worker alive (`EdgeRuntime.waitUntil`) for 31 seconds.
- Then `flushList` takes the window atomically (`push_list_take`, `for update`, so two callers never both send), recomputes the keys, diffs against the baseline, and pushes. The diff is net: an item added and removed again inside the window sends nothing.
- `push-cron` (below) also takes any window older than 30 seconds, so a function worker that died mid-window delays the push to the next 15-minute tick rather than losing it.

### Who gets it

The members other than the author, who have list changes on. If both members wrote inside one window nobody is notified (neither is "the" author, and each has just seen their own edit); this is rare for two people and documented rather than solved. The name comes from `household_members.display_name`, "Your partner" when unset, as in the toast.

### "Only while a trip is in progress"

The trip is inferred (CONTEXT.md), not stored, so "in progress" is read as: the household has items to buy. A window only sends when its net diff is not empty, which needs a to-buy list that is non-empty before or after. An emptied list still notifies (the partner in the shop wants to hear that the last item is gone), and a list that stays empty never does. We did not add a stricter test (for example "a shop is open") because nothing in the data says that, and a guess would silently drop real changes.

### Expiry reminders: cron every 15 minutes

`pg_cron` runs `push_cron_tick()` every 15 minutes; it posts to the `push-cron` function (`pg_net`). For each household with a subscribed device the function runs the replay up to today and, for each member whose reminder is due, lists the batches that still have stock and expire from today through `households.expiry_reminder_days` (default 2, 0 to 14, separate from `expiring_days`), one entry per ingredient. Nothing expiring means no push.

- Due means: the household-local wall clock (`Intl`, so DST is handled) is at or after the person's time and less than 3 hours past it, and `push_prefs.expiry_checked_on` is not today (`reminderDue` in `src/lib/notify.ts`). The grace keeps a late tick working but stops "turn it on at 14:00 for 09:00" from firing at once. Changing the time clears `expiry_checked_on` (a trigger), so a new time gets its chance the same day.
- The day is marked handled when the push went out, when there was nothing to send, or when every device was gone. If every attempt failed for a reason that may pass (a network error, 5xx) it is retried on the next tick.
- Batches already expired are left out: they were reported on earlier days, and a message that repeats every morning until the shelf is cleaned gets muted.
- `known` is refreshed on each tick while no window is open, because time moves the list too (the trip range rolls over at midnight, a batch expiring changes usable stock). Without it the next change would be blamed for that drift.

### Sender and secrets

Edge functions send the Web Push (VAPID, aes128gcm) with `npm:web-push@3.6.7`. It runs under Deno and `supabase functions serve` (verified: payload encrypts and decrypts, VAPID header is built, 404/410 handling works), and its key format is the plain base64url pair `web-push generate-vapid-keys` prints. `jsr:@negrel/webpush` was the alternative; it takes JWK-exported keys and has a smaller user base. Three functions:

- `push-list`, `push-cron`: called by the database with a shared secret (`x-push-secret` = `PUSH_WEBHOOK_SECRET`, compared in constant time), `verify_jwt = false`.
- `push-test`: "Send me a test notification", called by the signed-in person, which pushes only to that person's devices (the user comes from the verified token).

The database finds the functions through the one-row table `push_config` (URL and the same secret), which is empty after a migration, so nothing is sent until it is set per environment (README). The table has RLS on and no grants.

### Data

- **`push_subscriptions`** (user, endpoint unique, p256dh, auth). Not soft-deleted: this is an exception to ADR 0003. It is per user, not a household fact; an endpoint plus its keys is a credential; and a 404/410 from the push service means the endpoint is dead for good, so the sender must be able to remove it. Rows go on 404/410, on "Turn off", and with the account (`on delete cascade`). Clients can only read and delete their own rows; saving goes through `save_push_subscription`, which also moves an endpoint to a new user when someone else signs in on the same browser. Endpoints must be `https://` (the server fetches them).
- **`push_prefs`** (`list_changes`, `expiry_time` null = Off, `expiry_checked_on`) is its own table, not columns on `household_members`: members can read each other's membership rows and should not see when a partner gets reminders. No row means the defaults (list changes on, 09:00). The client cannot write `expiry_checked_on`. Time is wall-clock in the household timezone.
- `expiry_reminder_days` is a household setting (`households`, column-granted like the others).

### Service worker

`vite-plugin-pwa` keeps `generateSW`. `workbox.importScripts: ['push-sw.js']` pulls `public/push-sw.js` (the `push` and `notificationclick` handlers) into the generated worker. Switching to `injectManifest` would have meant owning the whole worker (precache, navigate fallback, font cache) for two small handlers. Notifications use the app icon and `tag: kind` with `renotify`, so a newer list push replaces the earlier one. A click focuses an open window and navigates it (Shop for list changes, Pantry for expiry), or opens one.

### Prompts

Android/desktop Chrome: a one-time card on the Plan tab (Turn on requests permission from the tap; Not now hides it for two weeks, per device, `localStorage`) and an "Install app" button from `beforeinstallprompt`. iPhone in Safari: web push does not exist until the page is installed, so the card is replaced by an install banner (Share, Add to Home Screen), dismissible for two weeks. Settings has the Notifications section. Both are hidden when the build has no `VITE_VAPID_PUBLIC_KEY`.

## Consequences

- The server and the phone run one set of rules, so the push says what the toast would say. The cost is that every list-affecting write triggers a server-side load (about a second of one edge function).
- The first change in a household before any baseline exists cannot be diffed: `known` is created by the first evaluation or the next cron tick (at most 15 minutes after the first subscription). That one change is not pushed.
- Delivery of list pushes is "about 30 to 35 seconds"; if the worker dies, up to 15 minutes. Reminders are as precise as the 15-minute tick.
- Changes that arrive in the same 30 seconds from both members notify nobody.
- A push the phone is offline for is kept by the push service for the TTL (1 hour list, 12 hours expiry) and a newer one of the same `topic` replaces it.
- Real delivery depends on the push services (FCM, APNs, Mozilla autopush) and, on iPhone, on the app being on the Home Screen. Subscriptions can lapse silently (the OS revokes them); the app re-saves its subscription on each load, and the sender deletes the dead ones.
