# src/lib/api: the data-access layer

Pages and hooks never import `supabase`. They talk to a `DataPort` (the seam), and every read and write goes through this folder.

```
port.ts             DataPort interface + ApiError + row/input types (the seam)
supabaseAdapter.ts  production adapter. The ONLY file with `supabase.` calls
fakeAdapter.ts      in-memory adapter for tests (+ `row.*` factories)
context.tsx         <ApiProvider api={...}> and useApi(); default = supabaseAdapter
keys.ts             EVERY query key and mutation key
command.ts          defineCommand / useCommand / runCommand (write + declared invalidations)
<aggregate>.ts      ingredients.ts, pantry.ts, ... : hooks for reads, commands for writes
```

Aggregates: ingredients, recipes, plan, shop, pantry, household, checkins, push, account. One file each.
Done so far (worked examples): `ingredients.ts` (+ `IngredientsPage`, `IngredientForm`), `pantry.ts` (`usePantry`), the shop mutations in `src/lib/shopMutations.ts`.

## Rules

1. A page/component/hook outside `src/lib/api/` imports no `supabase`, no `@tanstack/react-query` write helpers like `useMutation`/`invalidateQueries`, and writes no query-key literal. It uses `useXxx()` query hooks and `useCommand(cmd)`.
2. Port methods are plain `async` functions with plain args. They `throw ApiError` (never return `{ data, error }`). No React, no query client.
3. Business error messages ("An ingredient with this name already exists.") are mapped in the aggregate file from `ApiError.code`, not in the adapters and not in pages. Then the fake and Supabase give the same message.
4. Each command declares `invalidates` with `keys.*`. Nothing else invalidates.
5. Query keys keep their exact old values (they are persisted in localStorage). Copy the literal into `keys.ts` unchanged.
6. No behaviour change: same queries, same columns, same error text, same optimistic updates.

## Migrating a page, step by step

1. **List what the page does.** Grep it for `supabase`, `useQuery`, `useMutation`, `invalidateQueries`, `queryKey`, `softDelete`, `restoreRows`.
2. **Keys.** Make sure each key it uses exists in `keys.ts` (most do already). Add missing ones, same literal value. Replace every `['...']` literal in the page with `keys.x.y()`.
3. **Port.** For each distinct database operation add a method to the right group of `DataPort` in `port.ts` (create the group if new). Name it for the intent (`recipes.list`, `recipes.save`, `household.saveSlots`), not for the SQL. Add the row/input types it needs to `port.ts` (use `Tables<'...'>` / `TablesInsert<'...'>`). Keep it as small as the page needs.
4. **Supabase adapter.** Implement the method in `supabaseAdapter.ts` by moving the existing `supabase....` code in verbatim. Replace `if (error) throw ...` by `check(error)` (it throws `ApiError(message, code)`). Return the data.
5. **Fake adapter.** Implement the method in `fakeAdapter.ts` on `state` (add a field to `FakeState` and a `row.xxx` factory if the table is new). Mirror only the server rules the page relies on (unique name -> `ApiError(..., '23505')`, delete guard -> `'23503'`). Wrap it with `track(...)` like the others (already done by the group you add it to). `// shortcut:` comment anything left unfaked.
6. **Aggregate file.** In `src/lib/api/<aggregate>.ts` write
   - a hook per read: `useXxx()` = `useQuery({ queryKey: keys..., queryFn: () => api.group.method() })` with `const api = useApi()`;
   - a `defineCommand` per write: `run(api, input)` (map `ApiError.code` to the page's old message here) and `invalidates(input, output)` returning `keys.*` arrays.
7. **Page.** Replace the inline `useQuery` with the hook and each `useMutation` with `useCommand(cmd, { onSuccess, onError })` (UI-only callbacks). Delete the now-unused imports (`supabase`, `useQueryClient`, `useMutation`, `Tables`...). Mutation input must be ONE object: `save.mutate({ id, row })`.
8. **Test.** Add a test in `src/lib/api/<aggregate>.test.ts`: create `createFakeAdapter({...seed})`, `runCommand(qc, api, cmd, input)`, then assert on `api.state` and on `qc.getQueryState(key)?.isInvalidated`. See `api.test.ts`.
9. **Check.** `npx tsc -b`, `npx vitest run`, `npm run build`, `npm run lint`.

### Before / after

Before (page):

```tsx
const queryClient = useQueryClient()
const save = useMutation({
  mutationFn: async (row: TablesInsert<'ingredients'>) => {
    const { error } = ingredient
      ? await supabase.from('ingredients').update(row).eq('id', ingredient.id)
      : await supabase.from('ingredients').insert(row)
    if (error?.code === '23505') throw new Error('An ingredient with this name already exists.')
    if (error) throw new Error(error.message)
  },
  onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ingredients'] }); onClose() },
})
save.mutate({ name, unit })
```

After. `port.ts`: `ingredients: { save(id: string | null, row: IngredientInput): Promise<void> }`.
`supabaseAdapter.ts`:

```ts
async save(id, row) {
  const { error } = id ? await supabase.from('ingredients').update(row).eq('id', id) : await supabase.from('ingredients').insert(row)
  check(error)
},
```

`ingredients.ts`:

```ts
export const saveIngredient = defineCommand<{ id: string | null; row: IngredientInput }>({
  name: 'ingredients.save',
  run: async (api, { id, row }) => {
    try { await api.ingredients.save(id, row) }
    catch (e) {
      if (e instanceof ApiError && e.code === '23505') throw new Error('An ingredient with this name already exists.')
      throw e
    }
  },
  invalidates: () => [keys.ingredients.all()],
})
```

Page:

```tsx
const save = useCommand(saveIngredient, { onSuccess: onClose })
save.mutate({ id: ingredient?.id ?? null, row: { name, unit } })
```

### Invalidation details

- `invalidates` returns prefixes. `keys.household.all()` also covers settings and members.
- Default is invalidate on success (fire and forget, like the old `onSuccess`). Use `when: 'settled'` where the old code used `onSettled` (invalidate even on failure).
- Old code that did `await queryClient.invalidateQueries(...)` before continuing (e.g. `await invalidatePantry(qc)` in an async handler): use `await runCommand(qc, api, cmd, input)` (get `qc` from `useQueryClient()`, `api` from `useApi()`), or `mutateAsync` if the awaiting is only about the write.
- A command whose result decides the invalidation uses `output`: `invalidates: (_, out) => [...]`.
- Cache edits that are not invalidations (optimistic `setQueryData`) stay next to the command's `onMutate` in the page or in the offline module, and use `keys.*` too.

## Optimistic and offline mutations (shop)

`src/lib/shopMutations.ts` registers mutation functions on the QueryClient by mutation key (`setMutationDefaults`). A tick made offline is a paused mutation. TanStack persists the key and the variables, not the function. After a reload, `main.tsx` calls `resumePausedMutations()`, which finds the function again through the registered defaults.

Consequences, and what to do:

- Registration must run on every boot, before the cache is restored: `registerShopMutations(queryClient, supabaseAdapter)` in `main.tsx`, outside React.
- Those functions take the adapter as an argument at registration. They must never call `useApi()` (no React tree yet) and never close over something created per render or per test that cannot be rebuilt on boot. The one adapter object is shared: `main.tsx` passes the same `supabaseAdapter` to `<ApiProvider>`.
- Variables must be plain JSON (they are persisted): ids, numbers, ISO strings. Generate ids and timestamps when the user acts (`batchId`, `addedAt`), so a replay cannot double-insert. Port methods used here must be idempotent.
- In tests: `registerShopMutations(qc, fakeAdapter)`, then `qc.getMutationDefaults(BUY_KEY).mutationFn`. See `api.test.ts`.
- New offline-capable mutation: add its key to `keys.mutations`, register it in `registerShopMutations` (or a sibling `registerXxxMutations(qc, api)` called from `main.tsx`), use `useMutation({ mutationKey })` in the page with no `mutationFn`.

## Tests

```ts
const api = createFakeAdapter({ ingredients: [row.ingredient({ name: 'rice' })] })
const qc = new QueryClient()
await qc.prefetchQuery({ queryKey: keys.ingredients.all(), queryFn: () => [] })
await runCommand(qc, api, saveIngredient, { id: null, row: { name: 'pasta', unit: 'g' } })
expect(api.state.ingredients).toHaveLength(2)
expect(qc.getQueryState(keys.ingredients.all())?.isInvalidated).toBe(true)
```

`api.calls` lists port calls (`'ingredients.save'`), and `api.failNext('ingredients.save')` makes the next one throw. To render a component against the fake: `<ApiProvider api={fake}>`.
Importing `src/lib/api/*` in node is safe: the Supabase client is created on first use, not on import.

## Names

Hooks `useThings()` / `useThing(id)`. Commands are verb-first constants: `saveIngredient`, `deleteIngredient`, `answerCheckin`, command `name` = `'aggregate.verb'`. Port methods: `list`, `get`, `save`, `setX`, `usage`, intent names.
