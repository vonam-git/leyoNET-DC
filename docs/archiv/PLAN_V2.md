# Plan v2 - Ego-Lernspiel Netzwerktechnik (Stand 2026-11-19)

## Richtungsentscheid 2026-11-19 (User)

| Thema | Vorher (KONZEPT) | Jetzt |
|---|---|---|
| Perspektive | Third-Person GTA-artig, V -> Ego | **nur Ego** (reicht vorerst) |
| Figur | Mixamo, AnimationMixer, Aktionen | **vorerst aus** (`CHARACTER = false` in `game/src/main.js`; Code + `character.glb` bleiben) |
| Raum | Serverraum mit Kaltgang-Einhausung (Glas) | **direkt der Serverraum**, keine Einhausung (`room.CONTAINMENT = False`) |
| Ports | per Hover benannt | **Nummern sichtbar am Geraet** (Beschriftung wie bei echten Switches/Patchpanels) |

Abweichung von KONZEPT Kap. 1, 4, 5 und Roadmap "Charakter-Integration" - bewusst, auf Anweisung.

## Neue Bausteine

| # | Baustein | Beschreibung |
|---|---|---|
| B1 | Terminal-Geraet | Bildschirm/Laptop im bzw. am Rack, per Konsolkabel an den `CON`-Port eines Switches |
| B2 | CLI | Switch per Kommandozeile parametrieren, gemaess leyonet-Kern (Intent `console`, Ausgabe vom Kern) |
| B3 | Inventar | Was man besitzt (Kabel, Geraete), sichtbar per Taste |
| B4 | Shop | Katalog + Budget, kaufen -> Inventar (Intent `buy`, Kern verbucht) |
| B5 | Level-System | Szenarien L1 ... Ln, Auswahl beim Start, Fortschritt im Kern |
| B6 | Simulierte GUI | z. B. Netzwerkeinstellungen eines Notebooks (IPv4/Maske/Gateway) |

## Level-Leiter (Vorschlag)

| Level | Raum | Aufgabe | neu gelernt |
|---|---|---|---|
| L1 | Tisch mit 2 Notebooks | 2 Notebooks direkt per Kabel verbinden, IP + Maske in der GUI setzen, Ping ok | Kabel, IPv4, Subnetz |
| L2 | Tisch + kleiner Switch | 3 Notebooks ueber einen Switch, gleiches Netz | Switch, Ports, LEDs |
| L3 | Serverraum, 1 Rack | Dosen (Patchpanel) auf Switch patchen gemaess Plan, Farbstandard | Patchpanel, Plan lesen |
| L4 | Serverraum | Laptop an Switch-Konsole, VLANs per CLI, Ports zuweisen | CLI, VLAN |
| L5 | Serverraum, 2 Racks | Uplink, Trunk, Gateway/Router | Trunk, Routing |
| L6+ | RZ-Halle | mehrere Rack-Reihen nach Verkabelungsplan, Budget, Stoerungen | Planung, Fehlersuche |

## Entscheidungen D1-D4 (User, 2026-11-19)

| # | Frage | Entscheid |
|---|---|---|
| D1 | Womit wird der Switch konfiguriert? | **Laptop mit Konsolkabel** am `CON`-Port, **oder per SSH** ueber den Management-Port (`MGMT`, `interface vlan 1` als Verwaltungsadresse) |
| D2 | Woher kommt die CLI? | **aus dem leyonet-Kern** (`github.com/vonam-git/leyoNET`, `src/core/cli/cli.ts`) |
| D3 | Wo spielt Level 1? | **Tisch im Serverraum** |
| D4 | Wann kann man einkaufen? | **jederzeit per Taste** (Overlay); spaeter kann ein Szenario auf eine Einkaufsphase begrenzen |

## Offene Auftraege (Backlog)

- [x] **KVM** (2026-11-19): 1U-KVM-Schublade in HE 34; E oeffnet die Rack-Konsole (Konsolserver) mit einem Reiter
      je Switch/Router/Firewall im Rack, leyoNET-CLI ohne Laptop und Konsolkabel
- [x] **Port-Nummern groesser** (2026-11-19): Switch 4 mm, Patchpanel 5 mm, hellerer Kontrast - so gross, wie es
      die Frontplatte ohne Ueberlappung zulaesst
- [ ] **Einhausungs-Tueren** per E (erst nach Kern-Anbindung, Kosmetik)
- [ ] **Figur** wieder aktivieren (`CHARACTER = true`), wenn Third-Person wieder gewuenscht
- [x] **SSH auf die Switches** (D1, Entscheid User 2026-11-19): **SSH nur auf L3-Switches** (wie leyoNET:
      `ip ssh` / `transport input ssh` nur fuer Layer-3-Geraete). Die Rack-Switches (L2) bleiben ohne SSH und
      werden per Konsolkabel oder KVM verwaltet; SSH ueben die Lernenden auf Router, Firewall bzw. L3-Switch.
- [ ] **leyoNET-Befund**: Pruefbaustein `address` wertet SVIs (`interface vlan 1`) nicht aus -> im Spiel
      eigener Zieltyp `mgmt_address`; ggf. in leyoNET ergaenzen.
- [x] **Tab-Vervollstaendigung** in Konsole und SSH-Sitzung (Intent `console_complete` -> leyoNET `complete()`)
- [x] **Core-Switch (L3)** in HE 37 (2026-11-19): leyoNET `l3switch`, Level 7 (VLAN 10/20, `interface vlan`,
  Routing zwischen VLANs, SSH-Login als Ziel `ssh_login`)
- [x] **Strom** (2026-11-19): Notebooks starten aus (Einschaltknopf im Fenster, Status-LED, schwarzes Display);
  Netzgeraete per Stromkabel C13/C14 von der 0U-PDU (hinten im Rack, 24 Steckdosen) an das Netzteil (PSU);
  `scenario.ohne_strom`, Zieltyp `power` (L2 Switches, L4 Router, L5 Firewall, L7 Core-Switch)
- [x] **Inventar-Leiste** (2026-11-19): Tasten 1-9 / Mausrad waehlen das naechste Kabel (1 = Auto nach Laenge)
- [x] **GUI-Redesign** (2026-11-19): eigenes Designsystem `game/src/style.css` (Menue-Stil = Vorgabe des Users),
  Level-Karten, Shop-Karten mit Filter, Fenster/Terminal, Toasts, Tastenkappen, "Level geschafft"-Dialog
- [x] **Notebook realistischer** (2026-11-19): Alu-Gehaeuse, Tastenkappen, Glas-Touchpad, Display-Rahmen + Webcam,
  Scharnier, Lueftung, mehr Seitenports; Display zeigt Desktop bzw. ist aus
- [ ] **Strom fuer Server** (Server haben noch keine PSU-Ports; nur Kulisse)
- [x] **SFP-Module** im Shop (1G-SX / 1G-LX), E setzt ein, R nimmt heraus, LC-Glasfaserkabel, Level 6

## Befund leyonet-Kern (gelesen 2026-11-19, Stand `develop` f8f8c81)

- leyoNET ist ein vollstaendiger Netzwerksimulator; `src/core` ist reines TypeScript **ohne DOM**,
  laeuft im Browser (auch offline als eine HTML-Datei). Der Node-Server macht Sessions, Klassen,
  Pruefungen - die **Simulation laeuft im Client**.
- Passende Bausteine: `connect(topology, a, b, medium, ports)` (Kabel), `cli.execute(session, line,
  env)` -> `{ session, lines, topology }` (CLI im FRRouting-/Cisco-Stil, Ports `port1..`, `sfp1..`,
  `interface vlan 1`, SSH), Geraetetyp `notebook`, Pruefbausteine `connected`, `sameNetwork`, `ping`
  (`tasks/tasks.ts`), Richtpreise CHF (`model/costs.ts`) fuer den Shop, Stoerungen (`tasks/faults.ts`).
- **Folge fuer die Architektur:** Statt eines eigenen LocalKern mit WS-Bridge kann das Spiel den
  leyoNET-Kern direkt einbinden ("EmbeddedKern" hinter der bestehenden KernClient-Schnittstelle).
  Das weicht von KONZEPT Kap. 1/2 ab (dort: Kern server-autoritativ, WS-Bridge).
- **Lizenz:** leyoNET steht unter **AGPL-3.0**; leyonet-dc hat keine LICENSE-Datei. Wer den Kern
  einbindet und das Spiel ueber das Netz anbietet, muss den Quelltext unter AGPL bereitstellen.
  -> Entscheid des Rechteinhabers noetig, bevor Code eingebunden wird.

## Umsetzung Kern-Anbindung (2026-11-19, User-Entscheid: direkt einbinden + Sync-Bot, AGPL-3.0)

- Lizenz: leyoNET-DC steht unter **AGPL-3.0-or-later** (`LICENSE`, `NOTICE.md`), Quelltext-Link im Spiel.
- Kern als Git-Submodul `vendor/leyonet` (Branch develop, gepinnt), Alias `@leyonet/core`,
  `game/tsconfig.leyonet.json`; Smoke-Test `game/scripts/check-core.ts` in `npm run check`.
- **Sync-Bot** `.github/workflows/leyonet-sync.yml` + `scripts/leyonet-sync.sh`: taeglich 04:15 UTC,
  auf Knopfdruck oder per `repository_dispatch` (`leyonet-updated`) -> Submodul auf neuesten
  leyoNET-develop, `npm ci` + `npm run check` + Build, PR auf develop (bei Fehlern Draft
  "[FEHLER]" mit Log), aeltere Bot-PRs werden geschlossen. Nie direkter Push auf develop/main.
  Lokal: `DRY_RUN=1 scripts/leyonet-sync.sh`.
- **Einmalig einzustellen (User, GitHub):** Settings -> Actions -> General -> "Allow GitHub Actions to
  create and approve pull requests". Optional in leyoNET: nach Push `repository_dispatch` an
  leyoNET-DC senden (braucht dort ein Token mit Zugriff auf dieses Repo).
- `.github/workflows/ci.yml`: Checks + Build bei Push auf develop und jedem PR.

## Fortschritt

- 2026-11-19 **EmbeddedKern aktiv**: Kabel, Link-LEDs, Ping-Ziele und Switch-CLI laufen im leyoNET-Kern.
  Dev-Szenario: Dose 07 -> sw1, Dose 13 -> sw2, Uplink sw1 <-> sw2 -> Ping AP07 -> AP13 (Kern-Simulation).
  Tests `check-embedded.ts` (14 Faelle) + Browser-Loop. Naechster Schritt: Laptop + Konsolkabel + Terminal-UI.
- 2026-11-19 **Laptop/Konsole, Shop, Level**: Tisch mit NB1/NB2/NB3 im Serverraum (lib/furniture.py),
  Notebook-Fenster (Netzwerk / Terminal mit ping, ipconfig, ssh / Konsole mit leyoNET-CLI ueber
  Konsolkabel), Shop + Inventar (B/I, Budget CHF), Level-Menue (L): L1 Notebooks verbinden + IP,
  L2 Patchen + Uplink, L3 Switch per Konsole (Verwaltungsadresse, write memory, Ping). Tests
  `check-levels.ts` spielen alle Level gegen den echten Kern durch.
- 2026-11-19 **Router + Firewall**: 1U-Router (U35, ETH0-3) und 1U-Firewall (U36, WAN/LAN/DMZ/OPT1) im Rack,
  Retrofit-Bake + Wear-Decals, im Kern `router` / `firewall` (SSH moeglich). Level 4 (zwei Netze ueber den
  Router, Gateways, SSH-Bonus) und Level 5 (LAN/DMZ, Firewall-Regel, noPing mit `requires`).
  Bugfix: Notebook-Gateway laeuft jetzt ueber leyoNETs `configureHost` (vorher abgelehnt).
- 2026-11-19 **Glasfaser + Bedienung**: SFP-Module (leyoNET: beide Seiten gleiches Modul, sonst sfpMismatch),
  Intents `sfp_insert`/`sfp_remove`, Zieltyp `fiber_link`, Level 6 (Glasfaser-Uplink); Tab-Vervollstaendigung;
  groessere Port-Nummern.
- 2026-11-19 **KVM**: KVM-Schublade (HE 34) mit unsichtbarer Klickflaeche (Hotspot), Rack-Konsole im Spiel.
