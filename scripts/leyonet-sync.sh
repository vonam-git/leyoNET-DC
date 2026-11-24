#!/usr/bin/env bash
# leyoNET-Sync-Bot: uebernimmt Aenderungen des leyoNET-Kerns (Submodul vendor/leyonet, Branch
# develop) ins Spiel. Prueft mit den Spiel-Checks + Build und oeffnet einen PR auf develop - pusht
# nie direkt auf develop/main (CLAUDE.md). Laeuft in GitHub Actions (.github/workflows/leyonet-sync.yml).
#
# Lokal testen ohne Push/PR:   DRY_RUN=1 scripts/leyonet-sync.sh
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
SUB=vendor/leyonet
DRY_RUN="${DRY_RUN:-0}"

old=$(git -C "$SUB" rev-parse HEAD)
git submodule update --init --remote "$SUB"
new=$(git -C "$SUB" rev-parse HEAD)
if [ "$old" = "$new" ]; then
  echo "leyoNET unveraendert ($old) - nichts zu tun"
  exit 0
fi
short=${new:0:7}
log=$(git -C "$SUB" log --format='- %h %s' "$old..$new" | head -40)
echo "leyoNET $old -> $new"
echo "$log"

status=ok
report=$(mktemp)
(
  cd game
  npm ci --no-audit --no-fund
  npm run check
  npm run build
) >"$report" 2>&1 || status=fail
echo "Checks: $status"
tail -40 "$report"

if [ "$DRY_RUN" = "1" ]; then
  echo "DRY_RUN: kein Commit/PR. Submodul zurueck auf $old."
  git -C "$SUB" checkout -q "$old"
  exit 0
fi

branch="bot/leyonet-$short"
git switch -c "$branch"
git add "$SUB"
git -c user.name="leyonet-sync-bot" -c user.email="leyonet-sync-bot@users.noreply.github.com" \
  commit -m "chore: leyoNET-Kern -> $short" -m "$log"
git push -u origin "$branch"

title="chore: leyoNET-Kern -> $short"
draft=()
if [ "$status" != "ok" ]; then title="[FEHLER] $title"; draft=(--draft); fi
body=$(printf 'Automatischer Abgleich des leyoNET-Kerns (`%s`, Branch develop).\n\n**Neue Commits in leyoNET:**\n%s\n\n**Spiel-Checks + Build:** %s\n\n<details><summary>Log (Ende)</summary>\n\n```\n%s\n```\n</details>\n' \
  "$SUB" "$log" "$status" "$(tail -60 "$report")")
gh pr create --base develop --head "$branch" --title "$title" --body "$body" "${draft[@]}"

# aeltere, offene Bot-PRs schliessen (ueberholt)
gh pr list --state open --json number,headRefName --jq '.[] | select(.headRefName | startswith("bot/leyonet-")) | select(.headRefName != "'"$branch"'") | .number' \
  | while read -r n; do gh pr close "$n" --comment "Ueberholt durch #$(gh pr view "$branch" --json number --jq .number)"; done
