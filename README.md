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

RLS check:

```sh
docker exec -i supabase_db_spensa psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/rls_smoke.sql
```
