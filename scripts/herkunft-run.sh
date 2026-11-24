#!/usr/bin/env bash
# Woechentlicher Lauf des Herkunfts-Bots (.github/workflows/herkunft.yml): online pruefen, Quellenangaben erneuern (PR auf
# develop), Fehler als Issue melden. Pusht nie direkt auf develop/main (CLAUDE.md).
# Lokal ohne Push/PR/Issue:   DRY_RUN=1 scripts/herkunft-run.sh
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
DRY_RUN="${DRY_RUN:-0}"
report=$(mktemp)
status=ok
node scripts/herkunft-bot.mjs --online | tee "$report" || status=fail
files=(docs/HERKUNFT.md game/src/herkunft.json game/public/lizenzen.txt)
if [ "$DRY_RUN" = "1" ]; then echo "DRY_RUN: $status"; git diff --stat -- "${files[@]}"; exit 0; fi

if ! git diff --quiet -- "${files[@]}"; then
  branch="bot/herkunft-$(date -u +%Y%m%d)"
  git switch -c "$branch"
  git add "${files[@]}"
  git -c user.name="herkunfts-bot" -c user.email="herkunfts-bot@users.noreply.github.com" commit -m "chore: Quellenangaben erneuert (Herkunfts-Bot)"
  git push -u origin "$branch"
  gh pr create --base develop --head "$branch" --title "chore: Quellenangaben erneuert (Herkunfts-Bot)" --body-file "$report"
fi
title="Herkunfts-Bot: Fehler bei Quellen oder Lizenzen"
nr=$(gh issue list --state open --search "in:title \"$title\"" --json number --jq '.[0].number // empty')
if [ "$status" = "fail" ]; then
  if [ -n "$nr" ]; then gh issue comment "$nr" --body-file "$report"; else gh issue create --title "$title" --body-file "$report"; fi
  exit 1
elif [ -n "$nr" ]; then
  gh issue close "$nr" --comment "Behoben: letzter Lauf ohne Fehler."
fi
