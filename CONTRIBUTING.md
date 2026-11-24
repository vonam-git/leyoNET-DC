# Mitmachen

Fehler und Ideen: bitte ein [Issue](https://github.com/vonam-git/leyoNET-DC/issues) eröffnen. Sicherheitslücken nicht öffentlich melden,
siehe [SECURITY.md](SECURITY.md).

## Ändern

1. Von `develop` abzweigen. `main` erhält Änderungen nur über einen Pull Request von `develop`.
2. Vor dem Pull Request müssen diese Prüfungen grün sein:
   ```bash
   (cd game && npm ci && npm run check && npm run build && npm run build:server)
   node --test server/*.test.mjs
   node scripts/herkunft-bot.mjs --check
   ```
   Ohne die nicht öffentlichen Musterlösungen werden einige Verbund-Tests übersprungen (docs/VERBUND.md).
3. Commit-Nachrichten beginnen mit `feat`, `fix`, `perf`, `docs`, `checkpoint` oder `chore`.
4. Neue Dateien, Texturen, Pakete oder Adressen brauchen einen Eintrag in `docs/herkunft.json`. Nur Quellen mit freier Lizenz, nichts von
   fremden Servern laden.
5. Keine Personendaten, keine Zugangsdaten, keine grossen Binärdateien ausserhalb von `assets/out/`.

Beiträge stehen wie das Projekt unter der AGPL-3.0-or-later.

## Neue Version

1. `VERSION` und `CHANGES` in `game/src/info.js`, `version` in `game/package.json` (und Lockfile) und `server/package.json`, Abschnitt in
   `CHANGELOG.md`. `npm run check` prüft, dass alles übereinstimmt.
2. Pull Request `develop` → `main`, danach auf `main` den Tag setzen: `git tag -a v1.0.0 -m "leyoNET DC 1.0.0" && git push origin v1.0.0`
3. Der Workflow «Release» prüft, baut und legt einen **Entwurf** des Release an. Durchsehen und auf GitHub veröffentlichen.
