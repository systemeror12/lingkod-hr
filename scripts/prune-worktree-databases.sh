#!/usr/bin/env bash
# Lists hris_* databases that no current worktree's .env points at; these are
# left behind when a worktree is removed. Pass --drop to drop the listed ones.
# Usage: pnpm db:prune-worktrees [--drop]
set -euo pipefail

drop=false
case ${1:-} in
  '') ;;
  --drop) drop=true ;;
  *) echo "Usage: pnpm db:prune-worktrees [--drop]" >&2; exit 2 ;;
esac

main=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
psql() {
  docker compose -f "$main/infrastructure/compose.yaml" exec -T postgres \
    psql -U hris_local -d postgres -v ON_ERROR_STOP=1 -At "$@"
}

in_use=$(
  git worktree list --porcelain | sed -n 's/^worktree //p' | while read -r worktree; do
    if [[ -f "$worktree/.env" ]]; then
      sed -n -E 's#^DATABASE_URL=.*/([^/?]+).*#\1#p' "$worktree/.env"
    fi
  done | sort -u
)

orphans=()
while read -r database; do
  grep -qxF "$database" <<<"$in_use" || orphans+=("$database")
done < <(psql -c "SELECT datname FROM pg_database WHERE datname LIKE 'hris\_%' ORDER BY datname")

if ((${#orphans[@]} == 0)); then
  echo "No orphaned worktree databases."
  exit 0
fi

for database in "${orphans[@]}"; do
  echo "$database $(psql -c "SELECT pg_size_pretty(pg_database_size('$database'))")"
done

if ! $drop; then
  echo "${#orphans[@]} orphaned. Rerun with --drop to drop them."
  exit 0
fi

for database in "${orphans[@]}"; do
  psql -c "DROP DATABASE \"$database\"" && echo "Dropped $database"
done
