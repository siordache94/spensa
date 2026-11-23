# 0002: Scope all data to a household

## Status

Accepted, 2026-11-23.

## Context

Two people share one pantry and plan. The code is public and the Supabase anon key ships to the browser, so Row Level Security is the only thing protecting the data.

## Decision

- Every data table has a `household_id`, and RLS on every table allows access only when the user is a member of that household.
- Integrity of references is enforced by composite foreign keys `(household_id, <ref>_id)`, so a row can never point at another household's row, even with a leaked id.
- Members update only everyday settings on `households` (column-level grant). The invite code changes only through `rotate_invite_code()`, which invalidates old invites.
- A user belongs to one household (`household_members.user_id` is unique). Signup is open, but an account sees nothing until it creates a household or joins one with an invite code.
- Joining goes through a `security definer` function that checks the invite code, so the households table is never readable by non-members.
- Auth is email + password with long-lived sessions.

## Consequences

- A second person needs no data migration.
- Several households per user can come later by dropping the unique constraint and adding a "current household" choice.
- The service-role key is never used by the app and never committed.
