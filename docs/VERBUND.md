# Verbundsaufgaben

Eine Klasse baut gemeinsam einen Verbund aus Rechenzentren. Jeder Arbeitsplatz baut **einen Standort** (eigener Raum) mit **eigenen Adressen**,
schliesst ihn an die Leitung des Providers an und lässt ihn von der Lehrperson **abnehmen**. Adressplan und Stufen wie im Klassen-Verbund von
leyoNET (`vendor/leyonet/docs/verbund.md`, `federation.ts`).

## Ablauf

1. Admin-Board: Klasse eröffnen. Der **Klassencode** ist der Session-Code; die Lernenden geben ihn im Spiel ein (Esc → Klasse).
2. In der Klasse eine Aufgabe **freigeben**. Alle sehen sie innert 15 s im Spiel: Taste **J** (oder Esc-Menü).
3. Der Server vergibt den **Platz** (1–60, bleibt je Klasse gleich). Das Auftragsblatt (J) zeigt die Adressen dieses Platzes.
4. Bauen: Rack, Geräte, Kabel, Konfiguration. **Übergabe = Dose 24 am Patchpanel PP1**: Router oder Firewall dort anstecken.
5. **Dashboard** (Beamer): Karte, Kacheln, Anforderungs-Matrix, Ticker. Klick auf einen Standort: Ziele, Netzplan, Auftragsblatt, Musterlösung.
6. **Abnahme starten**: prüft alle Plätze frisch und hält das Ergebnis fest (Klassendatei, CSV). Die Lernenden sehen es im Spiel.

## Aufgaben (`game/src/verbund.js`)

| | Titel | Themen | Ziele | Richtzeit |
|---|---|---|---|---|
| V1 ★ | Anschluss ans Alpennetz | Rack, WAN, Standardroute | 6 | 30 min |
| V2 ★★ | Das Büro geht online | DHCP, NAT, DNS | 8 | 45 min |
| V3 ★★★ | Drei Zonen und ein Webauftritt | VLAN, Trunk, Router-on-a-Stick, 1:1-NAT | 14 | 70 min |
| V4 ★★★★ | Festung mit Schaufenster | Firewall, DMZ, Glasfaser, SSH | 14 | 90 min |
| V5 ★★★★★ | Eigenes autonomes System | BGP, OSPF, Layer 3, ACL, Glasfaser | 22 | 120 min |

Richtzeiten sind geschätzt, nicht im Unterricht erprobt. 

## Musterlösungen (nicht öffentlich)

Sie stehen nicht im Repo, sondern in `loesungen.json` (Vorlage mit Platzhaltern je Platz, Format: `game/src/loesungen.js`):
- **Server:** nach `DATA_DIR/loesungen.json` legen (oder Pfad in `DC_LOESUNGEN`), kein Neustart nötig. Ohne Datei läuft alles, das Admin-Board zeigt nur keine Lösung.
- **Tests:** lokal `privat/loesungen.json`, auf GitHub das Secret `DC_LOESUNGEN`. Ohne Datei werden die Prüfungen übersprungen, die eine brauchen.

## Adressen je Platz n

Transit 203.0.113.(4n)/30 (Provider .4n+1, Standort .4n+2) · öffentlich 192.0.2.(4n)/30 (Webserver .4n+1) · intern 10.n.VLAN.0/24 · AS 65000+n ·
Zentrale 198.51.100.10 (`zentrale.verbund.example`, Web + DNS) · Provider AS 64500. Platz 62 = Referenz-Standort.

**Partner:** Plätze 1–2, 3–4, … Das Ziel «gemeinsam» geht zum Partner, sobald dessen Standort geprüft läuft; vorher antwortet der
Referenz-Standort (niemand wird vom Nachbarn blockiert). Im Spiel steht für den Partner ein Platzhalter mit der Stufe, die der Server gemessen
hat – fremde Konfigurationen verlassen den Server nicht.

## Was geprüft wird

Das Spiel schickt **Absichten**, nie Ergebnisse. Der Server spielt sie im selben Kern nach (Worker, 10 s / 160 MB je Platz), setzt Standort +
Provider + Zentrale + Partner mit `federate()` zusammen und wertet die Ziele aus. Stufen: nicht verbunden → angeschlossen → online → Dienste
erreichbar → fertig. Abgeschriebene Konfigurationen scheitern an den Adressen. Hostnamen sind frei (Ziele laufen über Kern-IDs).
Grenze: Wer ein fremdes Protokoll auf die eigenen Adressen umschreibt, wird nicht erkannt.

Seite neu laden oder Gerät wechseln: J → «Weiterbauen», der Server gibt das Protokoll zurück (nur Arbeitsspeicher, 12 h unbenutzt bzw. Neustart).
Läuft das Spiel beim Server-Neustart weiter, lädt es sein Protokoll selbst wieder hoch.

## API

| | |
|---|---|
| `POST verbund/start { fresh }` | beginnen / weiterbauen → `{ run, task, seat, intents, partner }` |
| `POST verbund/sync { run, from, intents }` | Protokoll nachführen; Lücke → `{ have, resync }` |
| `POST verbund/check` | Selbsttest (gleicher Test wie die Abnahme, 6/min) |
| `GET/POST admin/classes/:id/verbund` | Dashboard-Daten · `open`, `close`, `reopen`, `end` |
| `POST …/verbund/abnahme` | Abnahme im Hintergrund (Antwort sofort, Stand über GET) |
| `GET …/verbund/:pid` | ein Standort: Netzplan, Blatt, Musterlösung |

Tests: `game/scripts/check-verbund.ts` (Musterlösungen, 18 Abkürzungen, leerer Raum, Partner), `server/verbund.test.mjs` (Ablauf, Rechte, 24 Plätze ★★★★★).
24 komplett neue Plätze ★★★★★ prüfen dauert auf der Entwicklungs-VM rund 17 s; im laufenden Betrieb nur die geänderten.
