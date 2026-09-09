#!/usr/bin/env bash
# Publish @khirby/plugin-* whose package.json version is not on npm.
# Does not bump versions — bump in git is the release signal.
#
# Usage:
#   ./scripts/publish-changed-plugins.sh [--dry-run] [--since <sha>] [crm-plugin-…]
#
# --since: warn when a plugin dir changed vs that commit but the version is already
#          published (forgotten bump).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DRY_RUN=0
SINCE=""
PACKAGES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --since)
      SINCE="${2:-}"
      if [[ -z "$SINCE" ]]; then
        echo "Usage: $0 --since <sha>" >&2
        exit 1
      fi
      shift 2
      ;;
    --help|-h)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    crm-plugin-*) PACKAGES+=("$1"); shift ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ ${#PACKAGES[@]} -eq 0 ]]; then
  for dir in crm-plugin-*; do
    [[ -d "$dir" && -f "$dir/package.json" ]] && PACKAGES+=("$dir")
  done
fi

if [[ ${#PACKAGES[@]} -eq 0 ]]; then
  echo "No crm-plugin-* packages found."
  exit 1
fi

dir_changed_since() {
  local dir="$1"
  [[ -z "$SINCE" ]] && return 1
  git diff --name-only "$SINCE"...HEAD -- "$dir" | grep -q .
}

published() {
  local name="$1" version="$2"
  npm view "${name}@${version}" version --registry https://registry.npmjs.org >/dev/null 2>&1
}

published_any() {
  local name="$1"
  npm view "$name" version --registry https://registry.npmjs.org >/dev/null 2>&1
}

read_field() {
  local dir="$1" field="$2"
  node -e "const p=require('./$dir/package.json'); process.stdout.write(String(p['$field'] ?? ''))"
}

has_web_build() {
  local dir="$1"
  node -e "const p=require('./$dir/package.json'); process.exit(p.scripts && p.scripts['build:web'] ? 0 : 1)"
}

WARN=0
PUBLISHED=0
SKIPPED=0

for dir in "${PACKAGES[@]}"; do
  if [[ ! -f "$dir/package.json" ]]; then
    echo "skip $dir — no package.json"
    continue
  fi
  name="$(read_field "$dir" name)"
  version="$(read_field "$dir" version)"
  if [[ "$name" != @khirby/plugin-* ]]; then
    echo "skip $dir — name $name is not @khirby/plugin-*"
    continue
  fi

  if published "$name" "$version"; then
    SKIPPED=$((SKIPPED + 1))
    echo "skip $name@$version — already on npm"
    if dir_changed_since "$dir"; then
      WARN=1
      echo "WARNING: $dir changed since $SINCE but $name@$version is already on npm — bump package.json to ship"
    fi
    continue
  fi

  if ! published_any "$name"; then
    echo "first publish $name@$version"
  else
    echo "publish $name@$version"
  fi

  if [[ "$DRY_RUN" -eq 1 ]]; then
    continue
  fi

  if has_web_build "$dir"; then
    pnpm --filter "$name" run build:web
  fi

  pnpm --filter "$name" publish --access public --no-git-checks
  PUBLISHED=$((PUBLISHED + 1))
done

echo "done: published=$PUBLISHED skipped=$SKIPPED"
if [[ "$WARN" -eq 1 ]]; then
  exit 2
fi
