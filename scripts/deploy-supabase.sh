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
# Access token: $SUPABASE_ACCESS_TOKEN (a project-account PAT), else the CLI login.
#   A token set in .env.local or .env.deploy is loaded automatically, so this directory can use the Spensa
#   account while the CLI stays logged in to another account for other work. Keep the file gitignored.
# Database password: v3 uses a temporary login role; if you pass SUPABASE_DB_URL, it must contain the password.
# IPv4-only network: put the dashboard's Session pooler URI in $SUPABASE_DB_URL.
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

# Load only the keys this script needs from local files; do not source them as shell.
for env_file in .env.deploy .env.local; do
  [ -f "$env_file" ] || continue
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      SUPABASE_ACCESS_TOKEN=*|SUPABASE_DB_URL=*|SUPABASE_DB_PASSWORD=*)
        key="${line%%=*}"
        value="${line#*=}"
        value="${value%\"}"; value="${value#\"}"
        value="${value%\'}"; value="${value#\'}"
        current=""
        case "$key" in
          SUPABASE_ACCESS_TOKEN) current="${SUPABASE_ACCESS_TOKEN:-}" ;;
          SUPABASE_DB_URL) current="${SUPABASE_DB_URL:-}" ;;
          SUPABASE_DB_PASSWORD) current="${SUPABASE_DB_PASSWORD:-}" ;;
        esac
        [ -n "$current" ] || export "$key=$value"
        ;;
    esac
  done < "$env_file"
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

# A pooler URI is the fallback for IPv4-only networks (the direct host is IPv6-only). When only the token and
# database password are present, ask the Management API for the pooler host and build the Session-mode URL.
build_pooler_url() {
  [ -n "${SUPABASE_ACCESS_TOKEN:-}" ] && [ -n "${SUPABASE_DB_PASSWORD:-}" ] || return 1
  local body host user name pw
  body="$(curl -fsS -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    "https://api.supabase.com/v1/projects/$ref/config/database/pooler" 2>/dev/null)" || return 1
  host="$(printf '%s' "$body" | sed -n 's/.*"db_host"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  user="$(printf '%s' "$body" | sed -n 's/.*"db_user"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  name="$(printf '%s' "$body" | sed -n 's/.*"db_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  [ -n "$host" ] && [ -n "$user" ] || return 1
  pw="$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$SUPABASE_DB_PASSWORD" 2>/dev/null || printf '%s' "$SUPABASE_DB_PASSWORD")"
  SUPABASE_DB_URL="postgresql://$user:$pw@$host:5432/${name:-postgres}"
  echo "Using the Session pooler at $host:5432 for IPv4."
}

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  build_pooler_url || true
fi

db_cmd=(supabase db push --remote="${SUPABASE_DB_URL:-$ref}")
if [ -z "${SUPABASE_DB_URL:-}" ] && [ -n "${SUPABASE_DB_PASSWORD:-}" ]; then
  db_cmd+=(--password "$SUPABASE_DB_PASSWORD")
fi

run_db_push() {
  local out status=0
  out="$("${db_cmd[@]}" "$@" 2>&1)" || status=$?
  printf '%s\n' "$out"
  if [ "$status" -ne 0 ]; then
    case "$out" in
      *privileges*)
        echo >&2
        echo "The CLI token cannot access $ref. Use a PAT from the owning account:" >&2
        echo "  echo 'SUPABASE_ACCESS_TOKEN=sbp_...' >> .env.local   # gitignored" >&2
        echo "  npm run deploy:supabase" >&2
        ;;
      *IPv6*)
        echo >&2
        echo "This network has no IPv6 and the direct database host is IPv6-only." >&2
        echo "Add the database password to .env.deploy and the script builds the Session pooler URL:" >&2
        echo "  echo 'SUPABASE_DB_PASSWORD=...' >> .env.deploy" >&2
        echo "  npm run deploy:supabase" >&2
        echo "  # or paste the dashboard's Session pooler URI as SUPABASE_DB_URL" >&2
        ;;
    esac
    return "$status"
  fi
}

if [ "$target" = "all" ] || [ "$target" = "db" ]; then
  echo "==> Migrations"
  if [ "$dry_run" -eq 1 ]; then
    run_db_push --dry-run
  else
    run_db_push
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
