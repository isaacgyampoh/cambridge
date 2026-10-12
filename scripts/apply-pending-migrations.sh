#!/usr/bin/env bash
#
# Apply the migrations that have NOT yet been run: 0018 onward.
#
#   SUPABASE_ACCESS_TOKEN=sbp_xxx ./scripts/apply-pending-migrations.sh
#
# Create a token at https://supabase.com/dashboard/account/tokens
#
# ── WHY THIS EXISTS RATHER THAN apply-migrations.sh ────────────────────────
#
# That script globs "000*.sql", which matches 0001 to 0009 and NOTHING ELSE.
# Run today it would do both of the wrong things at once: skip every pending
# migration, and re-run 0001 — which DELETEs every row from pin_sessions and
# sets must_change_pin on every profile. Every member of staff signed out and
# made to choose a new PIN, and not one pending change applied.
#
# It is still correct for its own job, which is preparing a fresh database.
# This one is for a database that is already running.
#
# Every migration from 0018 on is written to be idempotent — IF NOT EXISTS,
# ON CONFLICT, ALTER ... IF NOT EXISTS — so re-running one that has already
# been applied is a no-op rather than an error. That is what makes it safe to
# run this without a record of which ones have been done.
#
# Nothing here drops a table or a column.

set -euo pipefail

REF="${SUPABASE_PROJECT_REF:-gejtxkbatldxbbqynpfg}"
API="https://api.supabase.com/v1/projects/${REF}/database/query"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/supabase/migrations"
FROM="${FROM_MIGRATION:-0018}"

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "SUPABASE_ACCESS_TOKEN is not set." >&2
  echo "  SUPABASE_ACCESS_TOKEN=sbp_xxx $0" >&2
  echo "Create one at https://supabase.com/dashboard/account/tokens" >&2
  exit 1
fi

query () {
  python3 -c 'import json,sys; print(json.dumps({"query": sys.stdin.read()}))' \
    | curl -sS -X POST "$API" \
        -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
        -H "Content-Type: application/json" \
        --data-binary @-
}

failed () { printf '%s' "$1" | grep -qE '^\s*\{.*"(error|message)"'; }

banner () { printf '\n\033[1m%s\033[0m\n%s\n' "$1" "$(printf '─%.0s' $(seq ${#1}))"; }

banner "Before"
printf '  tables without RLS : '
printf '%s' "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity=false;" | query
printf '\n  business rows      : '
printf '%s' "SELECT (SELECT count(*) FROM leads) leads,(SELECT count(*) FROM profiles) profiles,(SELECT count(*) FROM applications) applications,(SELECT count(*) FROM payments) payments;" | query
echo

banner "Applying migrations from ${FROM}"
applied=0
for f in "$DIR"/[0-9][0-9][0-9][0-9]_*.sql; do
  name="$(basename "$f")"
  # Everything before FROM has already been applied to this database.
  [[ "${name:0:4}" < "$FROM" ]] && continue
  printf '  %-42s ' "$name"
  out="$(query < "$f")"
  if failed "$out"; then
    printf '\033[31mFAILED\033[0m\n\n'
    printf '%s\n' "$out" | head -c 1200
    echo
    echo "Stopped. Nothing after this migration was applied." >&2
    exit 1
  fi
  printf '\033[32mok\033[0m\n'
  applied=$((applied + 1))
done

banner "After"
printf '  tables without RLS : '
printf '%s' "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity=false;" | query
printf '\n  business rows      : '
printf '%s' "SELECT (SELECT count(*) FROM leads) leads,(SELECT count(*) FROM profiles) profiles,(SELECT count(*) FROM applications) applications,(SELECT count(*) FROM payments) payments;" | query
printf '\n  fee reminders      : '
printf '%s' "SELECT value FROM settings WHERE key='payment_reminders_enabled';" | query
printf '\n  manual registration: '
printf '%s' "SELECT count(*) FROM information_schema.columns WHERE table_name='applications' AND column_name='registration_source';" | query
echo

printf '\n\033[32m\033[1m%s migration(s) applied.\033[0m\n' "$applied"
echo "  'tables without RLS' must now be 0  — that is CB-026, the live data leak."
echo "  'business rows' must be unchanged from Before."
echo "  'fee reminders' must read false, and 'manual registration' must read 1."
echo
echo "Then confirm from outside, with the key a stranger has:"
echo "  node scripts/verify-rls.mjs     # must exit 0"
