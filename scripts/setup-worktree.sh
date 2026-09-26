#!/usr/bin/env bash
# Prepares a linked git worktree for parallel development. Safe to rerun.
#
# Each worktree gets its own .env (copied from the main checkout) pointing at
# its own hris_<worktree> database, so migrations, integration tests, and E2E
# seeds never touch another checkout's data. Infrastructure containers stay
# shared and owned by the main checkout.
#
# T3 Code runs this on worktree creation: bash scripts/setup-worktree.sh
set -euo pipefail

worktree=$(git rev-parse --show-toplevel)
main=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
cd "$worktree"

if [[ "$worktree" == "$main" ]]; then
  echo "Run this in a linked worktree, not the main checkout." >&2
  exit 1
fi

slug=$(basename "$worktree" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9\n' '_')
database="hris_${slug:0:50}"

[[ -f .env ]] || cp "$main/.env" .env
sed -i -E "s#^(DATABASE_[A-Z_]*URL=.*/)hris\$#\1${database}#" .env
database=$(sed -nE 's#^DATABASE_MIGRATION_OWNER_URL=.*/([^/?]+).*$#\1#p' .env)

if [[ "$database" == "hris" ]]; then
  echo "Refusing to migrate the main checkout's hris database from a worktree." >&2
  exit 1
fi

# Use the main checkout's compose file so containers keep its bind mounts;
# --no-recreate keeps a config drift here from restarting shared services.
compose=(docker compose -f "$main/infrastructure/compose.yaml")
"${compose[@]}" up -d --no-recreate --wait
if ! "${compose[@]}" exec -T postgres psql -U hris_local -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname = '${database}'" | grep -q 1; then
  "${compose[@]}" exec -T postgres psql -U hris_local -d postgres -c "CREATE DATABASE \"${database}\""
fi

run() { fnm exec --using .node-version "$@"; }
run pnpm install --frozen-lockfile
run pnpm db:migrate
run pnpm --filter @lingkod-hr/web exec playwright install chromium

echo "Worktree ready: database ${database}"
