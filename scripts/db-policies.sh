#!/usr/bin/env bash
# Prints the live grants, row-level security flags, and RLS policies for the
# tables matching a psql pattern, as the migrations have built them so far.
# Usage: pnpm db:policies <table-or-pattern>   e.g. agency_profile_versions, 'leave_*'
set -euo pipefail

pattern=${1:?Usage: pnpm db:policies <table-or-pattern>}
cd "$(git rev-parse --show-toplevel)"
main=$(git worktree list --porcelain | sed -n '1s/^worktree //p')

url=${DATABASE_MIGRATION_OWNER_URL:-$(grep -E '^DATABASE_MIGRATION_OWNER_URL=' .env | cut -d= -f2-)}
database=${url##*/}
database=${database%%\?*}
like=${pattern//\*/%}

# psql interpolates :'like' only in commands read from stdin, not from -c.
docker compose -f "$main/infrastructure/compose.yaml" exec -T postgres \
  psql -U hris_local -d "$database" -v ON_ERROR_STOP=1 -v like="$like" <<SQL
\\dp $pattern
SELECT relname AS table, relrowsecurity AS rls_enabled, relforcerowsecurity AS rls_forced
FROM pg_class WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace
AND relname LIKE :'like' ORDER BY relname;
SQL
