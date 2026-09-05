#!/usr/bin/env bash
#
# Apply migrations 0001–0005 to the Cambridge Supabase project, in order,
# stopping at the first failure.
#
#   SUPABASE_ACCESS_TOKEN=sbp_xxx ./scripts/apply-migrations.sh
#
# Each migration is wrapped in BEGIN/COMMIT internally, so a failure rolls that
# migration back rather than leaving it half-applied. The script stops on the
# first error so a later migration never runs against a database the earlier
# one did not finish preparing.
#
# WHAT THIS CHANGES THAT YOU CANNOT UNDO BY RE-RUNNING:
#
#   0001  DELETE FROM pin_sessions
#         Every member of staff is signed out and signs in once more. This is
#         intended — session tokens are now stored hashed, so the old plaintext
#         rows could never match a lookup again anyway. Given the service_role
#         key was public, invalidating every existing session is the correct
#         outcome regardless.
#
#   0001  DROP POLICY on five over-permissive policies
#         sessions_public_read (USING true), applications_insert and
#         activities_insert (WITH CHECK true), signins_public_insert,
#         documents_read. Public application and testimonial submission keep
#         working: those go through server routes using the service role and
#         never needed an anon INSERT policy.
#
#   0001  UPDATE profiles SET must_change_pin = TRUE
#         Everyone chooses a new PIN at next sign-in. Nobody is locked out:
#         existing hashes still verify and are re-hashed with scrypt on the way
#         through.
#
#   0005  Normalises delivery values to the canonical enum.
#         Rows it cannot classify are reported, not guessed at.
#
# Nothing here drops a table or a column. Business data — leads, profiles,
# applications, payments — is not touched.
#
set -euo pipefail

REF="${SUPABASE_PROJECT_REF:-gejtxkbatldxbbqynpfg}"
API="https://api.supabase.com/v1/projects/${REF}/database/query"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/supabase/migrations"

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "SUPABASE_ACCESS_TOKEN is not set." >&2
  echo "Create one at https://supabase.com/dashboard/account/tokens" >&2
  exit 1
fi

# Send one SQL string to the Management API. Prints the response body.
query () {
  python3 -c 'import json,sys; print(json.dumps({"query": sys.stdin.read()}))' \
    | curl -sS -X POST "$API" \
        -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
        -H "Content-Type: application/json" \
        --data-binary @-
}

banner () { printf '\n\033[1m%s\033[0m\n%s\n' "$1" "$(printf '─%.0s' $(seq ${#1}))"; }

banner "Before"
printf '  tables without RLS : '
printf '%s' "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity=false;" | query
printf '\n  business rows      : '
printf '%s' "SELECT (SELECT count(*) FROM leads) leads,(SELECT count(*) FROM profiles) profiles,(SELECT count(*) FROM applications) applications,(SELECT count(*) FROM payments) payments;" | query
echo

banner "Applying migrations"
for f in "$DIR"/000*.sql; do
  name="$(basename "$f")"
  printf '  %-34s ' "$name"
  out="$(query < "$f")"
  # The API returns an array on success and an object carrying message/error on failure.
  if printf '%s' "$out" | grep -qE '^\s*\{.*"(error|message)"'; then
    printf '\033[31mFAILED\033[0m\n\n'
    printf '%s\n' "$out" | head -c 1200
    echo
    echo "Stopped. Nothing after this migration was applied." >&2
    exit 1
  fi
  printf '\033[32mok\033[0m\n'
done

banner "After"
printf '  tables without RLS : '
printf '%s' "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity=false;" | query
printf '\n  business rows      : '
printf '%s' "SELECT (SELECT count(*) FROM leads) leads,(SELECT count(*) FROM profiles) profiles,(SELECT count(*) FROM applications) applications,(SELECT count(*) FROM payments) payments;" | query
printf '\n  functions present  : '
printf '%s' "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('auth_throttle_hit','auth_throttle_reset','assign_lead_atomic','assign_lead_to','bump_lead_pending','claim_due_sms','claim_event','record_payment_once','apply_fee_payment','next_admission_number');" | query
echo

printf '\n\033[32m\033[1mMigrations applied.\033[0m\n'
echo "  'tables without RLS' should now be 0, business rows unchanged,"
echo "  and 'functions present' should be 10."
echo
echo "Next: set the remaining environment variables, then 'npm run preflight'."
