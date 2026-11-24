#!/bin/bash
# dev-dc Pull-Deploy (Variante A, 2026-11-20): laeuft auf dem Plesk-Server als Geplante Aufgabe
# (alle 5 Min.) und holt den Build aus dem GitHub-Release "dev-latest" - nur HTTPS ausgehend,
# Port 22 bleibt fuer GitHub zu. Braucht nur bash, curl, tar, sha256sum.
#
#   bash /pfad/zum/ordner/dev-dc-pull.sh <Dokumentstamm>
#   z.B. bash /var/www/vhosts/<abo>/deploy/dev-dc-pull.sh /var/www/vhosts/<abo>/dev-dc.leyonet.ch
#   (Dokumentstamm: Plesk -> Website -> Hosting-Einstellungen; Pfad dort ist relativ zu /var/www/vhosts/<abo>)
#
#   mit Admin-Board: ... <Dokumentstamm> <App-Ordner>   (legt server/*.cjs ab und startet die App neu; Daten bleiben unberuehrt)
#
# Token: fine-grained GitHub-Token, NUR dieses Repo, Berechtigung "Contents: Read-only",
# als Datei github-token NEBEN diesem Skript (chmod 600). Tut nichts, wenn version.txt unveraendert ist.
set -euo pipefail

DEST=${1:?Dokumentstamm als Argument angeben}
APP=${2:-}   # optional: Ordner der Node.js-App (Plan v4 F, docs/ADMIN_SERVER.md), AUSSERHALB des Dokumentstamms
REPO=${DEV_DC_REPO:-vonam-git/leyoNET-DC}
TAG=${DEV_DC_TAG:-dev-latest}
API=${DEV_DC_API:-https://api.github.com}
HERE=$(cd "$(dirname "$0")" && pwd)
TOKEN_FILE=${DEV_DC_TOKEN_FILE:-$HERE/github-token}

[ -d "$DEST" ] || { echo "Dokumentstamm fehlt: $DEST (Pfad in Plesk unter Hosting-Einstellungen pruefen)" >&2; exit 1; }
[ -w "$DEST" ] || { echo "kein Schreibrecht im Dokumentstamm: $DEST (gehoert die Subdomain zu diesem Abonnement?)" >&2; exit 1; }
if [ -n "$APP" ]; then
  [ -d "$APP" ] && [ -w "$APP" ] || { echo "App-Ordner fehlt oder kein Schreibrecht: $APP" >&2; exit 1; }
  case "$(cd "$APP" && pwd)/" in "$(cd "$DEST" && pwd)/"*) echo "App-Ordner darf nicht im Dokumentstamm liegen: $APP" >&2; exit 1;; esac
fi
[ -r "$TOKEN_FILE" ] || { echo "Token-Datei fehlt: $TOKEN_FILE" >&2; exit 1; }
TOKEN=$(tr -d ' \r\n' < "$TOKEN_FILE")

# nie zwei Laeufe gleichzeitig
LOCK="$HERE/.dev-dc-pull.lock"
mkdir "$LOCK" 2>/dev/null || { echo "laeuft schon (Lock $LOCK)"; exit 0; }
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"; rmdir "$LOCK" 2>/dev/null || true' EXIT

gh_api() { curl -fsSL --retry 2 -H "Authorization: Bearer $TOKEN" -H "X-GitHub-Api-Version: 2022-11-28" "$@"; }

# Release lesen und die API-URLs der Assets herausziehen (ohne jq)
gh_api -H "Accept: application/vnd.github+json" "$API/repos/$REPO/releases/tags/$TAG" > "$TMP/release.json"
asset_url() {
  grep -oE '"(url|name)": *"[^"]*"' "$TMP/release.json" | awk -v want="$1" -F'"' '
    $2 == "url" && $4 ~ /\/releases\/assets\// { u = $4 }
    $2 == "name" && $4 == want && u != "" { print u; exit }'
}
download() {
  local u
  u=$(asset_url "$1")
  [ -n "$u" ] || { echo "Asset $1 fehlt im Release $TAG" >&2; exit 1; }
  gh_api -H "Accept: application/octet-stream" "$u" -o "$TMP/$1"
}

download version.txt
if [ -f "$DEST/version.txt" ] && cmp -s "$TMP/version.txt" "$DEST/version.txt"; then
  exit 0   # nichts Neues
fi
echo "neue Version: $(cat "$TMP/version.txt") (bisher: $(cat "$DEST/version.txt" 2>/dev/null || echo keine))"

download dev-dc.tar.gz
download dev-dc.tar.gz.sha256
(cd "$TMP" && sha256sum -c --quiet dev-dc.tar.gz.sha256)
mkdir "$TMP/new"
tar -xzf "$TMP/dev-dc.tar.gz" -C "$TMP/new"
[ -f "$TMP/new/index.html" ] && [ -d "$TMP/new/assets" ] || { echo "Paket unvollstaendig" >&2; exit 1; }

# 1) neue Dateien (Hash-Namen) dazu, 2) index.html, 3) version.txt als letztes = fertig
(cd "$TMP/new" && find . -type f ! -name index.html ! -name version.txt -print0) |
  while IFS= read -r -d '' f; do
    mkdir -p "$DEST/$(dirname "$f")"
    cp -f "$TMP/new/$f" "$DEST/$f.part" && mv -f "$DEST/$f.part" "$DEST/$f"
  done
cp -f "$TMP/new/index.html" "$DEST/index.html.part" && mv -f "$DEST/index.html.part" "$DEST/index.html"

# 4) alte Build-Dateien entfernen - NUR in assets/ und decoders/ (Rest des Dokumentstamms bleibt)
for dir in assets decoders; do
  [ -d "$DEST/$dir" ] || continue
  (cd "$DEST/$dir" && find . -type f -print0) | while IFS= read -r -d '' f; do
    [ -e "$TMP/new/$dir/$f" ] || rm -f -- "$DEST/$dir/$f"
  done
done
# 5) Server (nur mit App-Ordner): pruefen, Dateien atomar ersetzen, App neu starten (Passenger)
if [ -n "$APP" ]; then
  download dev-dc-server.tar.gz
  download dev-dc-server.tar.gz.sha256
  (cd "$TMP" && sha256sum -c --quiet dev-dc-server.tar.gz.sha256)
  mkdir "$TMP/srv"
  tar -xzf "$TMP/dev-dc-server.tar.gz" -C "$TMP/srv"
  for f in app.cjs start.cjs replay-worker.cjs kern.cjs package.json; do
    [ -f "$TMP/srv/$f" ] || { echo "Server-Paket unvollstaendig: $f" >&2; exit 1; }
  done
  for f in kern.cjs replay-worker.cjs app.cjs package.json start.cjs; do
    cp -f "$TMP/srv/$f" "$APP/$f.part" && mv -f "$APP/$f.part" "$APP/$f"
  done
  mkdir -p "$APP/tmp" && touch "$APP/tmp/restart.txt"
fi
cp -f "$TMP/new/version.txt" "$DEST/version.txt"
echo "deployt: $(cat "$DEST/version.txt")"
