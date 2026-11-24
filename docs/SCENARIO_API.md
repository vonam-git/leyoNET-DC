# Szenario-API: Spiel <-> leyonet-Kern (v1, Entscheidungen E1-E3 vom 2026-11-19)

Grundlage: KONZEPT Kap. 1 (Kern = einzige Wahrheit, server-autoritativ), Kap. 6 (Szenarien als
YAML im Kern), Kap. 9 (Client sendet Absichten, nie Ergebnisse), Kap. 10 (State-on-change).

Das Spiel ist Darstellungsschicht. Es sendet **Intents** und rendert den **Zustand**, den der Kern
zurueckgibt. Punkte, Fortschritt, Budget und Zielerfuellung berechnet ausschliesslich der Kern.

```
 Spieler (E-Taste)                      Spiel                            Kern (Szenario-Engine)
 ─────────────────   CableManager ──► Intent {link a b}  ──► KernClient ──► validiert, wendet an
                     (nur UI-Vorpruefung)                                    │
                     CableManager ◄── State {rev, links, leds, goals} ◄──────┘
                     rendert Kabel, LEDs, Ziele
```

## 1. Bezeichner

| Begriff | Format | Beispiel | Quelle |
|---|---|---|---|
| Geraet | GLB-Node-Name | `r1_switch_U41` | Blender-Builder (`room._populate`) |
| PortRef | `<geraet>/<port>` | `r1_switch_U41/07`, `r1_patchpanel_U42/13`, `r1_switch_U41/mgmt` | Node `<geraet>_port_<nn>` |
| LedRef | `<geraet>/led_<id>` | `r1_switch_U41/led_p07`, `r1_server_01/led_pwr` | Node `<geraet>_led_<id>` |
| Port-Klasse | `copper` \| `sfp` \| `console` \| `power` | aus Extras `leyonet_port_kind` (rj45/keystone -> copper, power -> power) | GLB-Extras |
| Strom-Port | `<geraet>/psu`, `pdu<n>/<nn>` | `sw1/psu` (C14-Netzteil hinten), `pdu3/01` (C13-Steckdose der 0U-PDU) | Node `<geraet>_port_psu` / `<pdu>_port_<nn>` |

Der Kern kennt eigene IDs (`sw1/p3` im Konzept). **Entscheidung E1:** Die Abbildung GLB-Name <->
Kern-ID liefert der Kern pro Raum als **Raum-Manifest** (`devices: [{ id: "sw1", node:
"r1_switch_U41", ports: 28 }]`), mitgeschickt in der Antwort auf `hello`. Intents, Zustaende und
Szenario-YAML verwenden **Kern-IDs** (`sw1/07`); das Spiel uebersetzt ueber das Manifest und
prueft beim `hello`, dass jede Kern-ID einen GLB-Node findet. Das Manifest wird beim Bake aus
`room._populate` erzeugt. (Uebergang bis dahin: Kern-ID = GLB-Name - siehe Abschnitt 8.)

## 2. Intents (Spiel -> Kern)

Umschlag fuer alle Nachrichten:

```json
{ "v": 1, "seq": 42, "t": 1763550000123, "action": "link", "...": "..." }
```

| action | Felder | Bedeutung |
|---|---|---|
| `link` | `from: PortRef, to: PortRef, cable: { length, color, item? }` | Patchkabel stecken (Laenge = Standardlaenge aus der Kurven-Quantisierung). **E2:** im Katalog-Modus muss `item` (Katalog-Artikel aus dem Inventar) gesetzt sein, `length`/`color` folgen daraus; im Sandbox-Modus freie Palette, `item` entfaellt |
| `unlink` | `port: PortRef` | Kabel an diesem Port abziehen (beide Enden) |
| `hello` | `scenario: id, client: { version, quality }` | Sitzung beginnen, Kern antwortet mit vollem Zustand |

| `console_open` | `device: Kern-ID` (z.B. `sw1`), `from?` (Laptop mit Konsolkabel oder `kvm<n>` = Konsolserver im Rack: Switch/Router/Firewall ohne Kabel) | Konsolsitzung oeffnen -> `ack { session, lines, prompt }` (EmbeddedKern, leyoNET-CLI) |
| `console` | `session, line` | eine Zeile in der leyoNET-CLI ausfuehren -> `ack { lines, prompt, close }`; aendert sie die Konfiguration, folgt ein `delta` (LEDs/Ziele) |

| `buy` | `item, qty` | Shop: Budget minus Preis x Menge, Inventar plus Menge; `reject budget` wenn das Budget nicht reicht |
| `device_info` | `device` | Notebook: aktuelle `ip`, `mask`, `gateway`, `console` (Switch am Konsolkabel) |
| `set_ip` | `device, ip, mask, gateway?` | Notebook-Netzwerkeinstellungen (atomar; leeres Gateway = keins) -> `delta` |
| `host_ping` | `device, target` | Ping vom Notebook (Ziel: IP oder Geraetename) -> `ack { ok, lines }` |
| `host_http` | `device, url` | curl vom Notebook -> `ack { ok, lines }` (nur lesen) |
| `ssh` | `from, target, user, password` | SSH vom Notebook -> CLI-Sitzung wie `console_open`. leyoNET bietet SSH nur auf Router/L3-Switch/Firewall |

| `power` | `device, on?` | Notebook ein/aus (Akku; ohne `on` umschalten). Netzgeraete bekommen Strom nur per Stromkabel (`link` PSU <-> PDU) |
| `sfp_insert` / `sfp_remove` | `port, item?` | SFP-Modul aus dem Inventar in einen leeren Einschub / zurueck (nur ohne Kabel); Zustand `sfp: { 'sw1/25': '1G-SX' }` |
| `console_complete` | `session, line` | Tab: leyoNET `complete()` -> `ack { line }` (eindeutiges Wort ergaenzt) oder `line: null` |
| `install` / `uninstall` | `item, slot` (Rack, Notebook) oder `item, rack, u`; `device` | Ein-/Ausbau (Plan v3). `rack` darf auch `bench_1` sein (19-Zoll-Gestell auf dem Pult, 6 HE, Nodes `b1_*`). Ausgebaute Geraete behalten Konfiguration + SFP-Module (Plan v4 D); feste Einrichtung (`placed[].fixed`) ist nicht ausbaubar |
| `trunk` / `untrunk` | `a, b, item`; `device` | 24er-Leitung Patchpanel <-> Patchpanel in zwei Racks, ueber die Gitterrinnen |
| `desk_patch` / `desk_unpatch` | `device: 'td1', pp, first: 1|9|17`; `device` | Tischdose (8 Ports) fest auf einen 8er-Block eines Patchpanels auflegen / loesen. Zustand: `trunks[] { a: 'td1', b, first, ports: 8, desk: true }`. `sl1` = Steckdosenleiste am Pult (Steckdosen wie PDU) |

Spaeter: `mount` (Geraet in HE-Slot), `door` (Einhausungs-Tuer).

Das Spiel sendet **keine** Ergebnisse (kein "Ziel erfuellt", keine Punkte, keine LED-Zustaende).

## 3. Antworten (Kern -> Spiel)

| type | Felder | Wann |
|---|---|---|
| `ack` | `seq, rev` | Intent angenommen, Zustand `rev` enthaelt ihn |
| `reject` | `seq, code, reason` | Intent abgelehnt; `code`: `occupied`, `incompatible`, `unknown_port`, `same_port`, `not_linked`, `budget`, `rule` |
| `state` | `rev, links[], leds{}, goals[]` | voller Zustand (nach `hello`, nach Reconnect) |
| `delta` | `rev, links_add[], links_remove[{ id, reason, by }], leds{}, goals[]` | nur Aenderungen (State-on-change, Kap. 10). **E3:** jede Entfernung traegt Pflichtfelder `reason` (Text fuer den Spieler) und `by` (`player`, `budget`, `fault`, `teacher`, `resync`) |

```json
{ "type": "state", "rev": 7,
  "links": [{ "id": "L3", "a": "r1_switch_U41/07", "b": "r1_patchpanel_U42/07", "length": 0.25, "color": "#1f5fd1" }],
  "leds":  { "r1_switch_U41/led_p07": "on", "r1_switch_U41/led_p08": "off" },
  "goals": [{ "id": "g1", "text": "Arbeitsplatz 07 an Switch-Port 07 patchen", "done": true }] }
```

Regeln fuer den Client:
- Zustand mit `rev` <= aktuellem `rev` wird verworfen (Reihenfolge ueber WS nicht garantiert
  nach Reconnect).
- Bis zur Antwort zeigt das Spiel das Kabel als **Vorschau** (Geist); bei `reject` verschwindet
  es und der Prompt zeigt `reason`.
- LEDs kommen nur aus dem Zustand (Link-Logik, Fehler-Injektion wie "PSU defekt" liegt im Kern).
- **E3:** Der Kern darf Kabel entfernen, die das Spiel bereits zeigt. Das Spiel entfernt sie und
  zeigt `reason` im HUD (kurz hervorgehoben), ausser bei `by: player`.

## 4. Validierung - wer prueft was

| Pruefung | Spiel (UI-Hinweis) | Kern (verbindlich) |
|---|---|---|
| Reichweite, Sicht (nicht verdeckt) | ja | - |
| Kabelweg frei, Standardlaenge, Durchhang | ja (Geometrie) | Laenge als Angabe (Budget, Material) |
| Port-Klasse kompatibel | ja | ja |
| Port frei / belegt | ja | ja |
| Szenario-Regeln (Farbstandard, VLAN, Loop, Budget) | - | ja |

## 5. Szenario-Engine (im Kern, YAML) - fuer die Ziele relevante Teile

```yaml
id: L1-kmu-patch-01
raum: test_room_rack_pbr
budget: 300            # CHF, Patchkabel kosten je Laenge (hardware_katalog)
modus: katalog         # E2: katalog (Kabel nur aus dem Inventar) | sandbox (freie Palette)
hardware_katalog:
  - { item: patch-cat6-0.5-blau, typ: patchkabel, laenge: 0.5, farbe: "#1f5fd1", preis: 4.5 }
  - { item: patch-cat6-1.0-gelb, typ: patchkabel, laenge: 1.0, farbe: "#e0b21a", preis: 5.5 }
ziele:
  - id: g1
    typ: link            # genau dieses Paar
    a: sw1/07                 # E1: Kern-IDs, Abbildung auf GLB-Nodes per Raum-Manifest
    b: pp1/07
    text: "Arbeitsplatz 07 an Switch-Port 07 patchen"
  - id: g2
    typ: link_any        # Port an irgendeinen Port eines Geraets
    a: pp1/13
    b_device: sw2
    text: "Drucker (Dose 13) an den Switch U39"
  - id: g3
    typ: no_loop         # kein Switch-Switch-Kreis
fehler_injektion: []
didaktik: { efz: ["b2.1 Netzwerk verkabeln"] }
```

Katalog-Artikel tragen `klasse` (`copper` = Patchkabel, `console` = Konsolkabel, `sfp` = LWL,
`power` = Stromkabel C13/C14); ein Kabel passt nur an Ports seiner Klasse.

**Strom (2026-11-19):** Zustand `power: { nb1: 'off', sw1: 'on', ... }`. Notebooks starten **aus** und
werden im Notebook-Fenster eingeschaltet (`power`). Netzgeraete (sw/cs/rt/fw) haengen fest am Strom,
ausser sie stehen in `scenario.ohne_strom` - dann braucht es ein Stromkabel vom Netzteil (`<id>/psu`) an eine
PDU-Steckdose. Ohne Strom: alle Anschluesse im leyoNET-Kern `shutdown` (die Konfiguration bleibt und kommt
beim Einschalten zurueck), Betriebs-LEDs (pwr/sys) aus, Konsole/KVM/SSH abgelehnt, offene Sitzungen enden. `budget` (CHF) steht im Zustand.

Jedes Ziel kann `requires: <ziel-id>` tragen: es zaehlt erst, wenn das andere erfuellt ist (z.B. `noPing`
erst, wenn das Netz ueberhaupt funktioniert - sonst waere es am Anfang trivial erfuellt).

Zieltypen v1: `link`, `link_any`, **`power`** (`devices`: alle haben Strom), **`ssh_login`** (`device`: per
SSH angemeldet), **`no_default`** (`device`: keine statische Standardroute), **`fiber_link`** (`a_device, b_device`: Glasfaser zwischen zwei Geraeten, Link up)
(Spiel-Ebene), **`mgmt_address`** (`device, vlan, ip, mask`: Verwaltungsadresse
`interface vlan N` - leyoNETs Baustein `address` wertet SVIs nicht aus), **`core`** (beliebiger leyoNET-Pruefbaustein `check`,
z.B. `{ type: 'ping', from: 'AP07', to: 'AP13' }`, ausgewertet mit `evaluateGoal` des Kerns), `no_loop`;
spaeter `color_standard`, `count`, `budget_max`.

**Dosen (Patchpanel):** Das Patchpanel ist passiv und im leyoNET-Kern kein Geraet. `dosen:
{ 'pp1/07': { name, type, ip, mask } }` legt fest, welches Endgeraet hinter einer Dose haengt; ein
Kabel Switch <-> Dose wird im Kern zu Switch <-> Endgeraet. Dose ohne Endgeraet: Kabel liegt, kein Link.

## 6. Spiel-Module

| Modul | Rolle |
|---|---|
| `game/src/kern.js` `KernClient` | Schnittstelle: `send(intent) -> Promise<ack \| reject>`, `onState(cb)` |
| `game/src/embedded-kern.js` `EmbeddedKern` | **aktiv im Spiel:** LocalKern-Protokoll auf dem leyoNET-Kern (`vendor/leyonet`): Kabel = `connect`/`removeCable`, LEDs = `linkUpAt`, Ziele `core` = `evaluateGoal`, Konsole = `startSession`/`execute`. Switch: 24 Kupfer + 4 SFP (Glasfaser braucht SFP-Modul), `con` nur Konsolkabel, `mgmt` vorerst gesperrt (leyoNET verwaltet in-band); `rt<n>` = leyoNET `router` (Ports 01-04 = eth0-eth3), `fw<n>` = `firewall` (01 WAN, 02 LAN, 03 DMZ, 04 OPT1), `nb<n>` = `notebook` |
| `game/src/kern.js` `LocalKern` | In-Browser-Kern fuer Entwicklung/Offline: gleiche Regeln (occupied, incompatible, unknown_port, same_port, not_linked), LED-Link-Logik, Zieltypen `link`/`link_any`. Kein Budget, kein Loop-Check. |
| (spaeter) `WsKern` | WS-Bridge: MessagePack, JWT, Delta 10 Hz, Heartbeat 30 s (Kap. 2/10) - ersetzt `LocalKern` ohne Aenderung an `CableManager` |
| `game/src/cables.js` `CableManager` | E-Taste -> Intent; `applyState(state)` rendert Kabel + LEDs |

## 7. Entscheidungen (2026-11-19, ehemals offene Fragen)

**E1 - Zuordnung GLB-Node <-> Kern-ID: Raum-Manifest vom Kern.**
Begruendung: Der Kern ist die einzige Wahrheit (KONZEPT Kap. 1); GLB-Namen beschreiben die Physik
(Rack, HE-Slot), Kern-IDs die Rolle im Netz - zwei verschiedene Dinge. Szenarien sollen Raeume mit
anderer Belegung wiederverwenden (Level 1/2 im selben KMU-Schrank). Aufwand gering: Manifest wird
beim Bake erzeugt, `hello` validiert. Verworfen: GLB-Nodes nach Kern-IDs benennen (Kern-Logik im
Asset, jede Umbenennung = Rebuild + Bake); Hybrid (zwei Wege fuer dasselbe).

**E2 - Kabelfarben: Katalog pro Szenario (`modus: katalog | sandbox`), Katalog ist der Normalfall
in den Levels.**
Begruendung: Budget ist Kernmechanik und der Farbstandard ein Lernziel (KONZEPT Kap. 1.1, 7) - wer
falsch einkauft, kann nicht sauber patchen. Der Sandbox-Modus (Kap. 6) bleibt frei. Fuer den Client
ist der Unterschied klein (Farbe/Laenge kommen im `link`-Intent, nur die Quelle wechselt); nicht
vorhandene Artikel lehnt der Kern per `reject` (`budget` / `rule`) ab.

**E3 - Kern darf gezeigte Kabel zuruecknehmen, mit Pflicht-Grund (`delta.links_remove[].reason`,
`.by`).**
Begruendung: Ohne diese Faehigkeit funktionieren Fehler-Injektion, Lehrpersonen-Eingriff (Admin-
Konsole, Kap. 9) und Reconnect-Abgleich nicht. Der Grund macht aus "verschwundenem Kabel" einen
erklaerten Lernmoment ("Stoerung: Kabel an Dose 13 defekt"). Verworfen: Kabel nur durch den
Spieler entfernbar (widerspricht server-autoritativ, kein Weg zurueck nach Zustandsverlust).

## 8. Abgleich mit dem Code

Stand 2026-11-19: Alle Konflikte K1-K11 aus dem Abgleich nach E1-E3 sind behoben.

| # | Umsetzung |
|---|---|
| K1-K3 (E1) | `RoomManifest` (kern.js) bildet GLB-Node <-> Kern-Ref ab; `LocalKern` arbeitet nur mit Kern-IDs; `hello` liefert Manifest + Modus + Katalog, das Spiel validiert alle Port-Nodes. Dev-Szenario und Tests nutzen Kern-IDs (`sw1/07`, `pp1/13`, `sw2`). |
| K4 (E1) | `bake.write_room_manifest()` schreibt beim Bake `assets/out/<raum>.manifest.json` (Kern-IDs pro Rolle, im Rack von oben nach unten). |
| K5-K7 (E2) | Dev-Szenario `modus: katalog` mit `hardware_katalog` + `inventar`; der Client waehlt nur Laengen mit Bestand und sendet `item`; der Kern setzt Laenge/Farbe aus dem Katalog, bucht aus/ein und lehnt mit `rule` (kein Artikel) bzw. `budget` (kein Bestand) ab. Sandbox: freie Palette. |
| K8-K10 (E3) | `LocalKern` sendet nach `hello` einen vollen `state`, danach nur `delta` mit `links_remove[{ id, reason, by }]`; `reduceState()` fuehrt zusammen; das HUD zeigt Gruende ausser `by: player`; `injectFault()` simuliert Stoerungen (defektes Kabel geht nicht zurueck ins Inventar); `check-kern.mjs` deckt alles ab (24 Faelle). |
| K11 | Die Kabel-Vorschau bleibt bis `ack`/`reject` stehen (`CableManager.awaiting` / `resolve()`). |

Ergaenzung zu Abschnitt 3: Die `ack`-Antwort auf `hello` traegt `manifest`, `modus` und `catalog`.
Der Client puffert Nachrichten, die vor dem Abschluss von `hello` eintreffen.

**Verbundsaufgaben:** `scenario.verbund = { task, seat }` laesst Ziele, ping, curl und ssh im zusammengesetzten Netz (eigener Standort + Provider + Zentrale +
Partner) auswerten; `dosen` koennen `dhcp`, `gateway`, `web` tragen. Siehe docs/VERBUND.md.
