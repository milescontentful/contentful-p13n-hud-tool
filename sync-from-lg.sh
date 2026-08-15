#!/usr/bin/env bash
# sync-from-lg.sh — refresh this repo from the LG demo (canonical during active development).
# Copies the three source files, rewrites imports for the flat layout, scrubs app-specific
# strings (this repo is PUBLIC), and fails loudly if any app-specific string survives.
# Usage: ./sync-from-lg.sh [path-to-lg-repo]   (default ~/Projects/lg)
set -euo pipefail
LG="${1:-$HOME/Projects/lg}"
cd "$(dirname "$0")"

cp "$LG/src/components/OperatorHud.tsx" src/OperatorHud.tsx
cp "$LG/src/personalization/ntAdapter.ts" src/ntAdapter.ts
cp "$LG/src/personalization/optimization.ts" src/optimization.ts

# rewire imports for the flat src/ layout
sed -i '' \
  -e "s|'../domain/types'|'./types'|" \
  -e "s|'../domain/commerce'|'./types'|" \
  -e "s|'../personalization/ntAdapter'|'./ntAdapter'|" \
  -e "s|'../personalization/optimization'|'./optimization'|" \
  -e "s|'../lib/contentful'|'./personas'|" \
  src/OperatorHud.tsx

# scrub app/prospect-specific strings (extend these rules when the guard below fires)
sed -i '' \
  -e "s|demoPersona entries from 03 - LG|demoPersona entries from the space|" \
  -e 's|Marlowe \&amp; Co. and all product brands are fictional.|Operator tool — all staged demo data should be labeled in your app.|' \
  src/OperatorHud.tsx

# guard: NO app/prospect-specific strings may survive into the public repo.
# If this fires, add a scrub rule above — do not commit past it.
if grep -nE "03 - LG|Marlowe|pbwr7smsr88d|lg-display" src/*.ts src/*.tsx; then
  echo "✗ app-specific strings above survived the scrub — add scrub rules, then re-run" >&2
  exit 1
fi

SHA="$(git -C "$LG" rev-parse --short HEAD 2>/dev/null || echo uncommitted)"
sed -i '' "s|^Snapshot of milescontentful/lg-display @ .*|Snapshot of milescontentful/lg-display @ $SHA ($(date +%F)).|" README.md

git --no-pager diff --stat
echo "✓ synced from $LG @ $SHA — review the diff, then: git add -A && git commit && git push"
