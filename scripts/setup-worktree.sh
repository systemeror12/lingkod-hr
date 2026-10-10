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
# Add keys that are new in .env.example without touching existing local values.
# Encryption keys are secrets, so they are only reported missing, never written.
grep -E '^[A-Z_]+=' .env.example | grep -vE '^(DATA_ENCRYPTION_KEY|BLIND_INDEX_KEY)=' |
  while IFS= read -r line; do
    grep -q "^${line%%=*}=" .env || echo "$line" >>.env
  done
sed -i -E "s#^(DATABASE_[A-Z_]*URL=.*/)hris\$#\1${database}#" .env
database=$(sed -nE 's#^DATABASE_MIGRATION_OWNER_URL=.*/([^/?]+).*$#\1#p' .env)

if [[ "$database" == "hris" ]]; then
  echo "Refusing to migrate the main checkout's hris database from a worktree." >&2
  exit 1
fi

# Give each worktree its own E2E ports so a parallel Playwright run never
# reuses another worktree's servers. playwright.config.ts reads these from .env.
# Start from a slot derived from the slug and skip slots other worktrees claim.
claimed=$(git worktree list --porcelain | sed -n 's/^worktree //p' | grep -vxF "$worktree" |
  while read -r other; do sed -n 's/^PLAYWRIGHT_APP_PORT=//p' "$other/.env" 2>/dev/null || true; done)
slot=$(($(printf '%s' "$slug" | cksum | cut -d' ' -f1) % 1000))
for _ in {1..1000}; do
  app_port=$((20000 + slot * 10))
  grep -qxF "$app_port" <<<"$claimed" || break
  slot=$(((slot + 1) % 1000))
done
api_port=$((app_port + 1))
set_env() {
  if grep -q "^$1=" .env; then sed -i -E "s#^$1=.*#$1=$2#" .env; else echo "$1=$2" >>.env; fi
}
set_env PLAYWRIGHT_APP_PORT "$app_port"
set_env PLAYWRIGHT_API_PORT "$api_port"

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

missing=()
for key in DATA_ENCRYPTION_KEY BLIND_INDEX_KEY; do
  value=$(sed -nE "s/^${key}=[[:space:]]*['\"]?([^'\"[:space:]]*).*/\1/p" .env | tail -n 1)
  [[ -n "$value" ]] || missing+=("$key")
done
if ((${#missing[@]})); then
  echo "Missing or blank in $worktree/.env: ${missing[*]}." >&2
  echo "Startup requires both in every environment. Add them to .env (.env.example has" \
    "local-only values) and rerun; this script does not write secrets." >&2
  exit 1
fi

echo "Worktree ready on Node $(run node --version): database ${database} migrated," \
  "infrastructure healthy, E2E ports web ${app_port}, API ${api_port}"
