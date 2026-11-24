# Änderungen

Alle Versionen von leyoNET DC. Copyright © 2026 Mark v. A., AGPL-3.0-or-later.

## 1.1.0 – 2026-11-24

- Admin-Board: Statistik mit Spielern (jetzt, insgesamt, online, aktiv), Spielstarts, Levels, Verbundaufgaben, Klassen und Verlauf über 30 Tage; nur Zahlen
- Live (dc.leyonet.ch) geht nur noch `main`
- Unauffälliger Link vom Startbildschirm ins Admin-Board

## 1.0.0 – 2026-11-24

Erste vollständige Version, spielbar auf <https://dc.leyonet.ch>.

- 7 Levels: Kabel und Ping, Rack und Uplink, Konsole, Router, Firewall, Glasfaser, Core-Switch mit VLAN-Routing und SSH
- 5 Verbundaufgaben für die ganze Klasse, vom Server geprüft, mit Dashboard und Abnahme
- Klassen mit Pseudonymen, Admin-Board mit Zwei-Faktor-Anmeldung, Löschfristen
- Spielstände (Server oder Datei), Willkommensmenü, Hilfe, frei belegbare Tasten, Grafikstufen, Touch
- Freies Bauen und Demo-Rechenzentrum mit Zugangscode
- Startbildschirm mit Knopf «Projekt unterstützen» (Patreon)
- Alle Adressen, Befehle und Verbindungen rechnet der leyoNET-Simulationskern

Bekannte Grenzen: auf dem iPad und auf schwachen Grafikkarten noch wenig erprobt; Server im Rack haben noch keine Netzwerkports.

## 0.0.15 – 2026-11-24

- Zurück-Knöpfe: von der Level-Auswahl zum Startbildschirm, vom Level-Start zur Auswahl

## 0.0.14 – 2026-11-24

- ping an der Konsole von Router, Core-Switch und Firewall zeigt das Ergebnis
- show an der Konsole zeigt den laufenden Zustand: gelernte Routen (OSPF, BGP), Nachbarn, DHCP-Adressen

## 0.0.13 – 2026-11-24

- Spielstände: mit Klasse auf dem Server, sonst oder wenn zu gross als Datei; jederzeit wieder öffnen
- Willkommensmenü und Hilfe
- Einstellungen: Tasten frei belegen, Grafikqualität, FPS-Anzeige, Tastenhinweise ein/aus
- Freies Bauen mit unbegrenztem Budget braucht einen Zugangscode

## 0.0.12 – 2026-11-23

- Verbundaufgaben: fünf gemeinsame Aufgaben (★ bis ★★★★★), freigegeben von der Lehrperson; jeder Platz baut einen Standort mit eigenen Adressen (Taste J)
- Dashboard für den Beamer und Abnahme im Admin-Board
- Notebook-Terminal: curl

## 0.0.11 – 2026-11-23

- Kabel über den Racks sind angeschlossen: jedes Rack hat zwei Zuleitungen vom Abgangskasten durchs Dach bis zur PDU
- Trunks reichen bis ins Patchpanel
- Racks und Geräte besser lesbar (mehr Umgebungslicht)

## 0.0.10 – 2026-11-23

- Graffiti an den Wänden mit dem gesprayten ly
- Weniger Zeichenaufrufe: der Raum läuft auf schwächeren Geräten flüssiger

## 0.0.9 – 2026-11-23

- Klassen mit Pseudonymen und Admin-Board für Lehrpersonen (wenn der Server läuft)
- Speedrun-Timer mit Bestzeiten, ein- und ausschaltbar (T)
- Level neu starten im Menü
- Minikarte läuft auch beim Sprinten flüssig

## 0.0.8 – 2026-11-23

- Grosses Pult mit 19-Zoll-Gestell: Geräte vorkonfigurieren, die Konfiguration bleibt beim Umbau ins Rack
- Steckdosenleiste am Pult, Stromleiste 1 HE im Shop
- Tischdose mit 8 Ports: Leitung über die Decke auf ein Patchpanel nach Wahl
- Trunks laufen über die Gitterrinnen statt unter dem Boden

## 0.0.7 – 2026-11-23

- Neuer Auftritt im Stil von leyonet.ch
- Netzplan (N) und Minikarte (M): zeichnet mit, was gebaut wird
- Bildschirm an der Wand zeigt das Projekt live, wie in leyoNET
- Lichtschalter neben der Tür
- Steuerung per Touch (iPad)
- Level starten: selbst aufbauen oder fertig aufgebaut
- Über leyoNET DC, Quellen und Lizenzen, geprüft vom Herkunfts-Bot

## 0.0.6 – 2026-11-20

- Esc-Menü mit Version, Impressum und Datenschutz
- Zoom mit der rechten Maustaste
- Mit dem Stuhl am Pult entlangrollen (A/D)
- Lichtschalter
- Strom für KVM-Konsole und Server (Netzteil-Buchse)
- leyoNET-Favicon

## 0.0.5 – 2026-11-20

- Bauen statt Vorfinden: Racks, Geräte und Notebooks kaufen und einbauen
- Raum v3: 8 × 6 m mit Glasfront, 8 Rack-Plätze, Pult mit Stuhl
- Trunk zwischen Racks, Sandbox und Demo-Rechenzentrum
- Realismus: schwarze Racks, Kabeltrassen, helle Lochplatten

## 0.0.4 – 2026-11-20

- Erste Version auf dev-dc.leyonet.ch
- Detailliertes Notebook
- Inventar wählbar

## 0.0.3 – 2026-11-19

- Router, Firewall, Glasfaser mit SFP-Modulen, KVM, Core-Switch
- Strom per PDU
- Levels 4–7

## 0.0.2 – 2026-11-19

- leyoNET-Simulationskern eingebunden
- Notebooks mit Netzwerk und Terminal, Konsole, Shop
- Levels 1–3

## 0.0.1 – 2026-11-19

- Serverraum mit Rack im Browser
- Ports anwählen und Kabel stecken
