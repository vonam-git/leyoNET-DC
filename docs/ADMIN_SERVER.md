# Admin-Board + Klassen-Server (Plan v4 F)

Kleiner Node.js-Server (`server/`, nur Bordmittel, keine npm-Pakete) für Klassen, geprüfte Ergebnisse und das Admin-Board
(`/admin.html`). Ohne Server läuft das Spiel wie bisher ganz im Browser.

```
Browser ── /index.html, /admin.html, /assets  ──► Webserver (Dokumentstamm, wie bisher)
        └─ /api/…                             ──► Node.js-App (Passenger) ──► DATA_DIR (JSON-Dateien)
```

## Einmalig in Plesk einrichten (Subdomain dc.leyonet.ch)

Plesk verlangt: Der **Dokumentstamm liegt im Anwendungsstamm** (wie bei leyoNET: `server` und `server/public`). Darum zieht die Seite in
`dc-server/public` um; das alte Verzeichnis bleibt bis zum Schluss bestehen.

```
/var/www/vhosts/<abo>/dc-server/          Anwendungsstamm (start.cjs, app.cjs, kern.cjs … vom Pull-Skript)
/var/www/vhosts/<abo>/dc-server/public/   Dokumentstamm (index.html, admin.html, assets …)
/var/www/vhosts/<abo>/dc-data/            Daten (nie im Dokumentstamm)
```

1. **Ordner anlegen** (Plesk → Dateien, im Hauptordner des Abonnements): `dc-server`, darin `public`, und daneben `dc-data`.
2. **Pull-Skript erneuern:** `scripts/dev-dc-pull.sh` neu auf den Server kopieren (ältere Fassungen kennen das zweite Argument nicht) und die
   geplante Aufgabe ändern: `bash …/dev-dc-pull.sh /var/www/vhosts/<abo>/dc-server/public /var/www/vhosts/<abo>/dc-server`. Einmal
   «Jetzt ausführen»: In `dc-server` liegen danach `start.cjs`, `app.cjs`, `replay-worker.cjs`, `kern.cjs`, `package.json`, in `public` die Seite.
3. **Node.js** bei der Subdomain aktivieren: Version 22 oder neuer, Anwendungsmodus `production`, Anwendungsstamm `/dc-server`, Dokumentstamm
   `/dc-server/public`, Startdatei `start.cjs`, *NPM install* ist nicht nötig. Umgebungsvariablen:

   | Name | Wert |
   |---|---|
   | `DATA_DIR` | `/var/www/vhosts/<abo>/dc-data` |
   | `STATIC_DIR` | `/var/www/vhosts/<abo>/dc-server/public` (falls der Webserver `/` an Node weiterreicht) |
   | `DC_ADMIN_INVITE` | zufälliger Text, mindestens 16 Zeichen: einmalige Einladung für den ersten Admin |
   | `MAX_PLAYERS` | optional, Standard 3000 |

4. Prüfen: `https://dc.leyonet.ch/api/status` liefert `{"app":"leyonet-dc",…,"ready":true}`, `/` zeigt das Spiel, `/app.cjs` gibt 404.
5. `https://dc.leyonet.ch/admin.html` → «Ich habe eine Einladung» → Passwort (mind. 12 Zeichen) → QR-Code mit der
   Authenticator-App scannen → acht Wiederherstellungscodes ablegen. Danach `DC_ADMIN_INVITE` in Plesk löschen und App neu starten.
6. Webserver-Protokolle kurz halten (Datenschutzerklärung nennt 7 Tage) und `dc-data` in die Sicherung aufnehmen
   (Rotation höchstens 30 Tage, Konzept Kap. 8). Das alte Verzeichnis der Seite erst löschen, wenn alles läuft.

Alle Seiten geben 404, sobald Umgebungsvariablen gesetzt sind: bekannter Fehler der Plesk-Erweiterung «Node.js Toolkit» (EXTPLESK-9167,
Version 2.4.2) – Erweiterung aktualisieren.

Falls Plesk `/api/…` nicht an Node weiterreicht: bei der Subdomain unter *Apache & nginx* die «intelligente Verarbeitung statischer
Dateien» eingeschaltet lassen und unter *Node.js* die App neu starten. Meldungen stehen im Fehlerprotokoll der Subdomain.

**Admin-Zugang verloren:** `DC_ADMIN_RESET=1` und ein neues `DC_ADMIN_INVITE` setzen, App neu starten, Zugang neu einrichten, beide
Variablen wieder löschen. Klassen und Ergebnisse bleiben.

## Lokal

```
cd game && npm run build:server
cd ../server && DC_ADMIN_INVITE=mindestens-16-zeichen npm start     # Port 8787
cd ../game && npm run dev                                            # /api wird an 8787 weitergereicht
node --test server/*.test.mjs                                        # Tests
```

## Wie Ergebnisse geprüft werden (Konzept Kap. 9)

Das Spiel schickt nie «geschafft», sondern die Absichten des Levels (`docs/SCENARIO_API.md`). Der Server spielt sie in einem Worker
(Zeit- und Speichergrenze) mit demselben `EmbeddedKern` nach, verlangt alle Ziele und misst die Zeit selbst (Start → Meldung).
Verbundsaufgaben: docs/VERBUND.md. Unter 250 ms je Schritt gilt als Skript. Protokolle werden nicht gespeichert (ausser Spielstände, siehe unten). Wer ein fremdes Protokoll in plausiblem Tempo abspielt,
wird damit nicht erkannt – für Noten taugen die Zeiten nicht.

## Daten und Löschfristen

| Was | Wo | Dauer |
|---|---|---|
| Live-Stand, Netzplan beim Zuschauen | Arbeitsspeicher | höchstens 24 h bzw. bis Neustart |
| Klasse, Pseudonyme, Bestzeiten, Prüfsummen der Codes | `DATA_DIR/classes` | Semesterende + 3 Monate, oder sofort auf Wunsch |
| Konten (Kürzel, Passwort als scrypt, TOTP verschlüsselt) | `DATA_DIR/accounts.json`, `secret.key` | bis gelöscht |
| Verbundaufgabe: Spielschritte, Netze | Arbeitsspeicher | höchstens 24 h (12 h unbenutzt) bzw. bis Neustart |
| Verbundaufgabe: Platznummer, Abnahme-Ergebnis | `DATA_DIR/classes` | wie Klasse |
| Spielstände (höchstens 5 je Pseudonym, je 128 KB, zusammen 256 MB) | `DATA_DIR/saves`, verschlüsselt mit `secret.key` | bis selbst gelöscht, sonst mit dem Pseudonym |
| Statistik: Summen und Tageswerte (Spielstarts, Beitritte, Levels, Abnahmen, Spitze online), ohne Personenbezug | `DATA_DIR/stats.json` | Tageswerte 400 Tage, Summen unbegrenzt |
| Audit-Log (Konto, Aktion, Klasse/Pseudonym) | `DATA_DIR/audit` | 2 Jahre |
| IP-Adressen, Namen, E-Mail, Cookies | nirgends | – |

## Spielstände (2026-11-24)

Ein Spielstand ist das Protokoll der Spielschritte (`game/src/saves.js`). Mit Klasse liegt er auf dem Server; zu gross, voll, nicht erreichbar
oder ohne Klasse: Download als Datei. Der Server merkt sich beim Speichern selbst, wie lange der laufende Lauf schon dauert. Geöffnet zählt das
Level danach als geschafft, aber ohne Bestzeit. Ein Spielstand aus einer Datei zählt für die Klasse nie (er könnte von jemand anderem sein).

## Zugangscode fürs freie Bauen (2026-11-24)

Sandbox und Demo-RZ (unbegrenztes Budget) sind sichtbar, aber gesperrt. Zwei Codes: `mark` und `weitergabe`. Im Quelltext stehen nur Prüfsummen
(`game/src/freischaltung.json`). Neu erzeugen, ohne den anderen zu ändern: `cd game && node scripts/freischalt-codes.mjs weitergabe`
(eigenes Passwort: `--eigen`), danach committen; wer den alten Code benutzt hat, ist wieder gesperrt. Grenze: Das Spiel läuft im Browser und ist
quelloffen, wer es selbst ändert, umgeht die Sperre.

## Statistik (2026-11-24)

Admin-Board → Statistik. Lehrpersonen sehen ihre Klassen, der Admin alles. «Spieler insgesamt» zählt jeden Beitritt, auch später gelöschte; beim ersten Start
werden die vorhandenen Spieler und Ergebnisse übernommen. «Spielstarts» zählt Abrufe von `/api/status` (ein Aufruf je geladenem Spiel, keine Personen).

## Musterlösungen

`loesungen.json` nach `DATA_DIR` legen, dann zeigt das Admin-Board sie je Platz (docs/VERBUND.md).

## Bewusste Abweichungen vom Konzept

- **Zufällige Token statt JWT**, eigene Eingabeprüfung statt Zod: keine Pakete auf dem Server nötig, Abmelden wirkt sofort.
- **Abfrage alle 15 s statt WebSocket/MessagePack** (unter 0.1 KB/s je Person): läuft ohne Sonderregeln hinter Plesk.
- Noch nicht dabei: Fehlerreport per Mail, nächtlicher Audit-Agent, Zertifikat-PDF, XP/Badges.
