# Plan v3 - Bauen statt Vorfinden (Auftrag 2026-11-20)

User-Auftrag: Linksklick wie E; Rack und Tisch starten leer, alles (Racks, Geraete, Notebooks, KVM)
wird im Shop gekauft und auf vordefinierten Plaetzen eingebaut; Budget pro Szenario; Stuhl am Tisch
(hinsetzen); Racks untereinander per "Link nach unten" (Patchpanel <-> Patchpanel unter dem
Doppelboden); Demo-RZ (voll ausgebaut, umsehen + einstecken); Sandbox mit unbeschraenktem Budget;
groesserer Raum mit Glasfront und hellem Aussenbereich.

## Entscheide (User, 2026-11-20)

- **Raum:** Betonraum, eine lange Seite Glasfront (Alu-Pfosten-Riegel), draussen hell (Tageslicht).
- **Groesse:** 8 x 6 m, 2 Rack-Reihen a 4 Plaetze (8 Racks), Kaltgang dazwischen; Arbeitstisch mit
  3 Notebook-Plaetzen + Stuhl.
- **Levels:** alle 7 umbauen - Start leer, passendes Budget, Ziele "kaufen, einbauen, verbinden".
  Geraete-IDs vergibt das Spiel beim Einbau (erster Switch = sw1 ...).

## Gemeldete Regel-Abweichungen

- Konzept Kap. 3 "Baked Lighting": gekaufte Geraete koennen nicht in der Raum-Lightmap sein.
  Loesung: Raum (Waende, Boden, Glasfront, Tisch, Stuhl) gebacken; Geraete + Racks als Bausatz-GLB
  ohne Lightmap, AO steckt im Panel-Atlas (Retrofit), Beleuchtung im Spiel per PMREM-Environment,
  Intensitaet an die Raum-Lightmap angeglichen.
- Ziel < 2k Tris/Geraet: Notebook 16.5k (Max 50k eingehalten) - bleibt, hoechstens 3 im Raum.

## Architektur

- `assets/out/room_v3.glb` (+ manifest): leerer Raum, Slot-Empties `slot_rack_<n>` (n = 1..8,
  Position + Blickrichtung, Bodenausschnitt mit Buerstenleiste fuer den Link nach unten),
  `slot_nb_<n>` (1..3) auf der Tischplatte, `chair_1` (Sitzpunkt).
- `assets/out/kit.glb`: je Typ EIN Vorlagen-Objekt (rack_42he inkl. 2 PDU-0U, switch, coreswitch,
  patchpanel, server, router, firewall, kvm, blank_1u, notebook) mit den bekannten Overlay-Nodes
  (`_led_p<nn>`, `_port_<nn>`, `_display`, `_screen`). Export via bake.py (ohne Lightmap).
- Spiel: `placement.js` - Kauf landet im Inventar; Rack-Item + Rack-Platz = Rack einbauen;
  Geraet + freie HE im anvisierten Rack = einbauen (Geister-Vorschau gruen/rot, Hoehe in HE);
  Notebook + Tischplatz. Klonen der Vorlage, Umbenennen nach Instanz (`r3_switch_U41`), Batching
  (`batch.js`) nach jeder Aenderung neu. Ausbauen per R (zurueck ins Inventar, nur ohne Kabel).
- Kern: neue Intents `install { typ, ort, he }` / `uninstall { device }` -> EmbeddedKern
  `addDevice` zur Laufzeit; Manifest wird aus den eingebauten Geraeten erzeugt.
- Link nach unten: Artikel "Trunk 24x" verbindet Patchpanel A (Rack x) 1:1 mit Patchpanel B
  (Rack y) unter dem Doppelboden; Kern behandelt Port k von A und B als durchgeschaltet (passiv).
- Stuhl: E/Klick auf den Stuhl = hinsetzen (Kamera auf Sitzhoehe, Blick zum Tisch), Bewegung =
  aufstehen.
- Szenarien: L1-L7 leer mit Budget; `Sandbox` (Budget unbeschraenkt, alles leer); `Demo-RZ`
  (voll ausgebaut ueber dieselbe Einbau-Logik aus einer Liste, umsehen + einstecken).

## Etappen (je ein Commit) - Stand 2026-11-20: 1-8 umgesetzt, siehe docs/STATUS.md

1. Linksklick = E (sofort).
2. Bausatz: `blender/tasks/kit.py` -> `kit.glb` (+ Polycount, Renders).
3. Raum v3: `blender/lib/room_v3.py` + `blender/tasks/room_v3.py` (8 x 6 m, Glasfront, Aussenbereich,
   Slots, Doppelboden mit Kabeldurchfuehrungen, Tisch + Stuhl) -> `room_v3.glb`, Ref-Vergleich.
4. Spiel: Laden von Raum + Bausatz, Einbau-Logik, Shop-Artikel Racks/Geraete/Notebooks/KVM.
5. Kern: install/uninstall, dynamisches Manifest, Tests.
6. Stuhl + Hinsetzen.
7. Trunk "Link nach unten".
8. Levels L1-L7 umbauen, Sandbox, Demo-RZ; `npm run check` + Browser-Test; Deploy (Pull).
