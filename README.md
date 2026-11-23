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
