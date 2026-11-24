# Plan v4 - Rueckmeldungen aus dem ersten Test (User-Liste 2026-11-20)

## Entscheide (User, 2026-11-20)

- Admin-Board **mit Server** (Lehrpersonen, Accounts, Klassen; Konzept Kap. 9) - eigener Block am Schluss,
  braucht Node.js auf Plesk (VM hat keinen Plesk-Zugriff -> Einrichtung mit dem User/Admin klaeren).
- Pult-Anschluss: **Tischdose am Pult** (8 Ports), fest ueber die Deckentrasse mit einem Patchpanel
  verbunden; Rack + Patchpanel waehlbar (Dialog).
- Impressum/Datenschutz: **Vorlagen** aus vendor/leyonet/website (Platzhalter bleiben, nichts erfinden).

## Pakete (Reihenfolge)

A. Bedienung: Favicon (vendor/leyonet/branding/favicon.svg), Zoom rechte Maustaste, mit dem Stuhl links/rechts
   am Pult fahren (A/D sitzend), Lichtschalter, Strom fuer KVM + Server (PSU-Buchse, Kern: Strom fuer alle
   Geraete mit PSU).
B. Esc-Menue: Weiterspielen, Level, Netzplan, Admin-Board (Server, Paket F), Impressum, Datenschutz,
   Version 0.0.X + Versionsliste (game/CHANGELOG).
C. Netzplan: automatisch aus dem Kern-Zustand (Geraete, Kabel, Trunks, Strom, IPs), Zoom/Pan, Minimap oben
   rechts mit Netzplan-Umschaltung, ab Levelstart verfuegbar.
D. Arbeitsplatz: grosses Pult (Platz fuer Rack-Geraete zum Vorkonfigurieren), Stromleiste am Pult,
   1-HE-Stromleiste fuer das Rack (Shop), Tischdose -> Patchpanel ueber die Decke, Kabel zwischen Racks
   ueber die Gitterrinnen (Trunk-Darstellung nach oben statt durch den Boden), Lichtschalter-Modell.
E. Levelstart: "selbst aufbauen" oder "fertig aufgebaut" (Bauplan wird gestellt); Wand-Sprueche im
   Graffiti-Stil mit dem gesprayten "ly" aus dem Favicon.
F. Admin-Board mit Server (Plan folgt mit dem User).

## Nachtrag (User, 2026-11-23)

G. **Stil leyonet.ch** fuer alle Buttons/Fenster (vendor/leyonet/website/httpdocs/css/site.css): schwarz/weiss, Papier +
   Punktraster, Courier-Ueberschriften, 2-px-Rand, Protokollfarben nur mit Bedeutung; hell/dunkel nach System.
   Ersetzt den Tuerkis-Glas-Stil; Aufbau des Level-Menues bleibt (User: "genau richtig").
H. **Entwicklerangaben** im Menue (Mark, vonam.ch, mit Hilfe von KI) + **Quellen/Lizenzen**; Patreon-Link patreon.com/leyonet.
   **Herkunfts-Bot**: prueft in der CI bei jedem Push/PR und woechentlich Herkunft + Lizenz aller Bestandteile
   (npm, Texturen-Sets, Modelle, Submodul) gegen docs/herkunft.json, erzeugt die Anzeige im Spiel, bricht bei
   unbekannter Herkunft / nicht freigegebener Lizenz ab.
I. **Wandbildschirm**: zeigt den Netzplan (Paket C) live an der Wand, wie das Projekt in leyoNET aussieht.
J. **iPad-Steuerung**: Touch (Joystick links, Blick rechts, Knoepfe) - nur mit begrenztem Aufwand.

Reihenfolge ab jetzt: G+H (schnell sichtbar) -> C+I (ein Zeichner fuer Fenster, Minimap, Wand) -> J -> D -> E -> F (mit User).

## Stand 2026-11-23

Erledigt: A, B, C, D, F, G, H, I, J (Touch im Browser simuliert, auf echtem iPad noch nicht getestet), E (Levelstart + Graffiti); dazu
Speedrun-Timer (T, Menue), Level neu starten, Minikarte ohne Neuzeichnen pro Frame.
D im Detail: Pult 2.8 x 0.9 m mit 19-Zoll-Gestell (6 HE), Konfiguration bleibt beim Umbau erhalten; Steckdosenleiste `sl1`,
Stromleiste 1 HE im Shop; Tischdose `td1` -> Energiesaeule -> Gitterrinne -> Patchpanel (Dialog); Trunks ueber Kopf.
F im Detail: docs/ADMIN_SERVER.md (Einrichtung in Plesk durch den User noch offen).
Graffiti (game/src/graffiti.js): 5 Sprueche/Logo prozedural, Texte in `PIECES`; Struktur und Lightmap von der Betonwand, 1 Draw Call.
Draw Calls Demo-RZ: 10 Blicke, vorher 49-84, jetzt hoechstens 49 inkl. Graffiti (unify.js: ein Material je Textur-Set und Lightmap,
Toenung/Rauheit/Metall als Vertex-Attribute; Toenungen aus blender/tasks/tints.py -> tints.json, nach Aenderung an textures.SETS
neu erzeugen). Reserve ist klein: Vorschau, Markierungen und Geister-Box kommen im Spiel noch dazu. FPS auf echter iGPU/iPad nicht gemessen.
Offen: nur noch die Einrichtung durch den User (Plesk Node.js, ADMIN_SERVER.md).

Ref-Vergleich (Regel 3) Raum v3 gegen docs/refs/ref_pdc_server_room.jpg, 2026-11-23:
1. Rinnen fuehren dort viele schwarze Stromkabel -> zuerst Deko-Buendel, die frei endeten; seit v0.0.11 echte
   Zuleitungen A/B je aufgestelltem Rack: Abgangskasten (`power_box_a/b`) -> Rinne -> Dach-Einfuehrung -> PDU oben (`feedPath` in
   placement.js, Pruefung in check-desk.ts). Datenkabel in den Rinnen nur noch echte Trunks + Tischdose. (umgesetzt)
2. Decke mit Sprinklerrohren, hier leer -> `sprinkler_1/2` mit Schellen und Koepfen. (umgesetzt)
3. Kabel treten oben aus den Racks, hier geschlossenes Dach -> Buersten-Einfuehrung im Rackdach + echte Trunk-Wege. (umgesetzt)
4. Leuchten haengen dort ab, hier deckenbuendige LED-Baender (bleibt, moderner Raum).
