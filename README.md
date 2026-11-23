# Spensa

Plan the week's meals, know what's in the pantry, and get the shopping list that follows. See [CONTEXT.md](CONTEXT.md) for how it works.

## Develop

Needs Node 20+, Docker and the [Supabase CLI](https://supabase.com/docs/guides/cli).

```sh
npm install
supabase start              # local Postgres + Auth, applies supabase/migrations
cp .env.example .env.local  # paste the anon key printed by `supabase start`
npm run dev
npm test
```

## Deploy

Live at https://spensa.siordache94.workers.dev. Cloudflare Workers static assets (`wrangler.jsonc`) serve `dist/`; unknown paths fall back to `index.html`.

Cloudflare builds from GitHub on every push to `main`:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Build variables (set in the Cloudflare dashboard, not in the repo):
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY` (hosted project's publishable key)
  - `NODE_VERSION=22`

Hosted Google sign-in is configured in the Supabase dashboard (Authentication → Providers → Google) with the client from Google Cloud. The Google OAuth client's redirect URI is the hosted project's `/auth/v1/callback`.

Database: hosted Supabase project, connected through the Supabase GitHub integration. Every migration in `supabase/migrations` is applied automatically when `main` changes. Do not run `supabase db push` by hand.

Local production build: put the hosted values in `.env.production.local` (gitignored; Vite reads it only for `npm run build`). `.env.local` keeps the local stack for `npm run dev`.

Local stack ports are 544xx (`supabase/config.toml`), so the local API is http://127.0.0.1:54421. `npm run dev` listens on the LAN; from a phone on the same network, open `http://<laptop-ip>:5173`. The client swaps `127.0.0.1` for the page's host.

Schema changes, local:

```sh
supabase migration new <name>
supabase migration up
npm run db:types
```

Checks (each rolls back, safe to repeat on a non-empty database; `supabase db reset` first for a clean slate):

```sh
for f in rls_smoke rpc_smoke gdpr_smoke push_smoke; do
  docker exec -i supabase_db_spensa psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/$f.sql
done
```

## Signups

Spensa is invite-only. A new account is created only if **either** its email is on the allowlist **or** the signup carries the invite code of an existing household (the invite link `/?invite=CODE` fills it in). This is enforced by a Supabase Auth "before user created" hook, the Postgres function `public.hook_before_user_created`, so it cannot be bypassed from the client or by calling the Auth API directly. Existing users are never affected, and it also covers Google sign-in (a brand-new Google account must be on the allowlist; there is no way to pass an invite code through OAuth).

The allowlist is the table `public.signup_allowlist(email)`. Only the service role / SQL editor can read or write it. Emails are lowercase:

```sql
insert into public.signup_allowlist (email) values ('you@example.com');
```

Local: the hook is enabled in `supabase/config.toml` (`[auth.hook.before_user_created]`). Restart the stack (`supabase stop && supabase start`) after changing it.

### Enabling it on a hosted project

The migration creates the function and table, but the hook is a project setting that migrations cannot switch on. Do this once per project, in the Supabase dashboard:

1. Add yourself and anyone you want to be able to sign up without an invite: SQL Editor, run the `insert into public.signup_allowlist ...` above. (Existing accounts keep working without it.)
2. Authentication, then Hooks (called "Auth Hooks" in some dashboard versions), then **Before User Created**, then Add hook. Hook type **Postgres**, schema `public`, function `hook_before_user_created`. Enable and save.
3. Authentication, then Sign In / Providers: leave "Allow new users to sign up" **on** (turning it off would also block people with an invite; the hook is the gate). Leave "Allow anonymous sign-ins" off. Recommended: turn on "Confirm email".
4. Check: in a private window try to create an account with an unlisted email and no invite. It must fail with "Spensa is invite-only. Ask a household member for an invite link."

To fully close it (no invites either), remove the invite branch from the function or turn "Allow new users to sign up" off.

### Account deletion function

"Delete my account" in Settings calls the edge function `supabase/functions/delete-account`. Edge functions are **not** deployed by the GitHub integration. Deploy it once and after changes: `supabase functions deploy delete-account --project-ref <ref>` (it uses the project's built-in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; no secrets to set). Until it is deployed, the button shows an error and nothing is deleted.

## Notifications (web push)

Design: [ADR 0004](docs/adr/0004-web-push.md). Two kinds: a push to the other member when the shopping list changes (combined over 30 seconds), and a daily expiry reminder at each person's chosen time. People turn them on from the card on the Plan tab or in Settings. On iPhone, web push only works for the app added to the Home Screen (iOS 16.4+); Spensa shows install instructions there first.

### One-time setup (hosted)

1. **Generate VAPID keys** (a key pair identifies your server to the push services; keep the private key secret, and never commit it):

   ```sh
   npx web-push generate-vapid-keys --json
   ```

   Also pick a random shared secret for the database-to-function calls: `openssl rand -hex 24`.

2. **Set the function secrets** on the hosted project (this is the only place the private key lives):

   ```sh
   supabase secrets set --project-ref <ref> \
     VAPID_PUBLIC_KEY=<public> VAPID_PRIVATE_KEY=<private> \
     VAPID_SUBJECT=mailto:you@example.com PUSH_WEBHOOK_SECRET=<random>
   ```

   (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are built in.)

3. **Deploy the functions** (not done by the GitHub integration). The `verify_jwt` settings come from `supabase/config.toml`:

   ```sh
   supabase functions deploy push-test push-list push-cron --project-ref <ref>
   ```

4. **Tell the database where the functions are**, once, in the SQL editor. The migration creates the trigger and the 15-minute cron job (`spensa-push-cron`, `pg_cron` + `pg_net`; check Database, Extensions if your project did not enable them), but they do nothing until this row exists:

   ```sql
   insert into public.push_config (functions_url, webhook_secret)
   values ('https://<ref>.supabase.co/functions/v1', '<the same PUSH_WEBHOOK_SECRET>')
   on conflict (id) do update set functions_url = excluded.functions_url, webhook_secret = excluded.webhook_secret;
   ```

5. **Give the web build the public key**: add `VITE_VAPID_PUBLIC_KEY=<public>` as a Cloudflare build variable and redeploy. Without it the prompts stay hidden.

Check: on the phone, Settings, Notifications, Turn on, then "Send me a test notification". `select * from cron.job_run_details order by start_time desc limit 5` shows the cron runs and `select * from net._http_response order by created desc limit 5` what the database got back from the functions. Function logs are in the dashboard (Edge Functions). Rotating the VAPID keys invalidates every subscription: each person turns notifications off and on again in Settings.

### Local

```sh
npx web-push generate-vapid-keys --json     # a throwaway pair for this machine
```

Put `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` and `PUSH_WEBHOOK_SECRET` in `supabase/functions/.env` and `VITE_VAPID_PUBLIC_KEY` in `.env.local`. Both files are gitignored (`.env`, `.env.*`). Then:

```sh
supabase functions serve --env-file supabase/functions/.env
docker exec -i supabase_db_spensa psql -U postgres -c "insert into public.push_config values (true, 'http://host.docker.internal:54421/functions/v1', '<PUSH_WEBHOOK_SECRET>') on conflict (id) do update set functions_url = excluded.functions_url, webhook_secret = excluded.webhook_secret"
```

The service worker is build-only, so to try the real thing run `npm run build && npm run preview` (a phone needs HTTPS for push; a tunnel or the hosted deploy). Push cannot reach a phone from a local stack unless the phone can reach your laptop's functions and the push service can reach the phone, so most checking is done against the hosted project.

Try the reminder schedule by hand (`now` is accepted only with the secret):

```sh
curl -X POST http://127.0.0.1:54421/functions/v1/push-cron -H "x-push-secret: <PUSH_WEBHOOK_SECRET>" -d '{"now":"2026-11-27T09:05:00+01:00"}'
```

## Privacy

[PRIVACY.md](PRIVACY.md) is a template notice for whoever deploys Spensa: fill in the placeholders, publish it, and set `VITE_PRIVACY_URL` (a build variable) to its URL so the Settings page links to yours. Settings also has **Download my data** (JSON export) and **Delete my account**.
