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
for f in rls_smoke rpc_smoke gdpr_smoke; do
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

## Privacy

[PRIVACY.md](PRIVACY.md) is a template notice for whoever deploys Spensa: fill in the placeholders, publish it, and set `VITE_PRIVACY_URL` (a build variable) to its URL so the Settings page links to yours. Settings also has **Download my data** (JSON export) and **Delete my account**.
