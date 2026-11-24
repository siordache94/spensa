#!/usr/bin/env bash
# Deploy the Supabase side of Spensa: pending migrations, then the edge functions.
#
# Project ref resolution order:
#   1. $SUPABASE_PROJECT_REF
#   2. supabase/.temp/project-ref          (older CLI, written by `supabase link`)
#   3. supabase/.temp/linked-project.json  (current CLI, written by `supabase link`)
#
# Usage:
#   scripts/deploy-supabase.sh [all|db|functions] [--yes] [--dry-run]
#
# Access token: `supabase login`, or $SUPABASE_ACCESS_TOKEN.
# Database password: prompted for, or $SUPABASE_DB_PASSWORD.
set -euo pipefail

cd "$(dirname "$0")/.."

usage() {
  sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
}

target="all"
assume_yes=0
dry_run=0

for arg in "$@"; do
  case "$arg" in
    all|db|functions) target="$arg" ;;
    --yes|-y) assume_yes=1 ;;
    --dry-run) dry_run=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

command -v supabase >/dev/null 2>&1 || {
  echo "supabase CLI not found. Install it or add it to PATH." >&2
  exit 1
}

ref="${SUPABASE_PROJECT_REF:-}"

if [ -z "$ref" ] && [ -f supabase/.temp/project-ref ]; then
  ref="$(tr -d '[:space:]' < supabase/.temp/project-ref)"
fi

if [ -z "$ref" ] && [ -f supabase/.temp/linked-project.json ]; then
  ref="$(sed -n 's/.*"ref"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' supabase/.temp/linked-project.json)"
fi

if [ -z "$ref" ]; then
  cat >&2 <<'MSG'
No project ref found.
Run `supabase link --project-ref <ref>` once, or set SUPABASE_PROJECT_REF.
MSG
  exit 1
fi

# Functions: every directory except _shared is deployed.
functions=()
while IFS= read -r name; do
  functions+=("$name")
done < <(find supabase/functions -mindepth 1 -maxdepth 1 -type d ! -name '_shared' ! -name 'node_modules' ! -name '.*' -exec basename {} \; | sort)

if [ "$assume_yes" -eq 0 ] && [ ! -t 0 ]; then
  echo "Non-interactive shell: pass --yes to confirm the deploy." >&2
  exit 1
fi

echo "Supabase project: $ref"

if [ "$dry_run" -eq 0 ] && [ "$assume_yes" -eq 0 ]; then
  echo "This will apply pending migrations and deploy: ${functions[*]}"
  read -r -p "Continue? [y/N] " answer
  case "$answer" in
    y|Y|yes|YES) ;;
    *) echo "Aborted."; exit 1 ;;
  esac
fi

db_cmd=(supabase db push --remote="$ref")
if [ -n "${SUPABASE_DB_PASSWORD:-}" ]; then
  db_cmd+=(--password "$SUPABASE_DB_PASSWORD")
fi

if [ "$target" = "all" ] || [ "$target" = "db" ]; then
  echo "==> Migrations"
  if [ "$dry_run" -eq 1 ]; then
    "${db_cmd[@]}" --dry-run
  else
    "${db_cmd[@]}"
  fi
fi

if [ "$target" = "all" ] || [ "$target" = "functions" ]; then
  if [ "${#functions[@]}" -eq 0 ]; then
    echo "==> Functions: none found under supabase/functions" >&2
  elif [ "$dry_run" -eq 1 ]; then
    echo "==> Functions (would deploy): ${functions[*]}"
  else
    echo "==> Functions: ${functions[*]}"
    supabase functions deploy "${functions[@]}" --remote="$ref" --yes
  fi
fi

echo "Done."
