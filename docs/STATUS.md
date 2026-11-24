# Status - Stand 2026-11-24 (v1.1.0)

- v1.1.0: Statistik im Admin-Board (`/api/admin/stats`, `admin-statistik.js`, `stats.json`), Versionsnummer im Startbildschirm -> admin.html. Live geht nur `main`.

- Release v1.0.0 vorbereitet: README, NOTICE (Copyright Mark v. A.), CHANGELOG, CONTRIBUTING, SECURITY, Vorlagen, Workflow `release.yml` (Tag -> Entwurf).
- Aus dem Repo genommen (lokal vorhanden): character.glb (Mixamo), alte Testraeume, Referenzfotos ohne Quelle. Alte Plaene in docs/archiv/.
- dc.leyonet.ch laeuft mit Klassen-Server. Offen: Git-Historie vor einer Veroeffentlichung (siehe CONTRIBUTING/Release).

- v0.0.14: `ping` und `show` an der Konsole rechnen mit der leyoNET-Simulation (`EmbeddedKern._liveSim`); beim Nachspielen (quiet) nicht.

## 2026-11-24 - Spielstände, Willkommen, Einstellungen, Hilfe, Zugangscode

- `saves.js`/`menus.js`/`settings.js`/`hilfe.js`/`freischaltung.js`; Server `/api/saves` (docs/ADMIN_SERVER.md). Tests `check-save.ts`, `app.test.mjs`.
- Willkommensmenü statt Level-Liste beim Start; Tasten frei belegbar (Tausch bei Doppelbelegung), Grafik niedrig/mittel/hoch, FPS-Anzeige,
  Tastenhinweise (K), Hilfe (H). Verbundaufgaben brauchen kein Speichern (laufend auf dem Server).
- Sandbox + Demo-RZ nur mit Zugangscode (zwei Codes, nur Prüfsummen im Repo).
- Nicht getestet: echtes Plesk (Node noch nicht eingerichtet), iPad, schwache iGPU.

## 2026-11-20 - Ref-Vergleich Raum v3 (Realismus-Regel 3) + Ladegroesse

Render/Screenshots (Demo-RZ) vs. `docs/refs/` - Unterschiede:
1. Rack-Gehaeuse gebuerstet grau statt matt schwarz (ref_network_aisle_front) -> **behoben**: `rack_powder`
   (Metal027, RAL 9005 matt, Albedo 0.04; `rack_black` 0.012 wirkte im Spiel wie ein Loch).
2. Lochplatten im Kaltgang fast schwarz (metal = 1 nimmt kein Lightmap-Licht) -> **behoben**: hell
   pulverbeschichtet, metal 0, 1K.
3. Keine Kabeltrassen ueber den Racks (ref_pdc_server_room) -> **behoben**: Gitterrinnen ueber beiden Reihen +
   Querverbindung, Gewindestangen alle 1.2 m, Kabelbuendel mit Durchhang + Binder (Regel 5),
   lib-Test `test_cable_trays.py`; dazu Feuerloescher + Notausgang-Schild (props.py).
4. Rasterdecke mit Paneelen fehlt (offen). 5. Vertikale Kabelfuehrungen zwischen Racks fehlen (offen).
- Spiel: Bausatz-Materialien envMapIntensity 3.0 (keine Lightmap). Vorher/Nachher `blender/render/compare/room_v3_*`.
- Ladegroesse: Normal-Maps per `nsize` (Boden-Albedo bleibt 2K, Relief 1K; Pflaster-Normal 512, Lochplatte 1K)
  -> room_v3.glb 16.61 -> **12.87 MB** trotz Trassen (Raum 73'014 Tris); Erstaufruf **21 MB** (< 25 MB).

## 2026-11-20 - Plan v3: Bauen statt Vorfinden (docs/archiv/PLAN_V3.md)

- **Linksklick = E** (sobald die Maus gefangen ist; der erste Klick faengt nur die Maus ein).
- **Bausatz** `assets/out/kit.glb` (5.53 MB, `blender/tasks/kit.py`, Export `bake.export_kit` ohne Lightmap):
  je Typ eine Vorlage (Rack 42 HE + 2 PDU-0U, Switch, Core-Switch, Patchpanel, Server, Router, Firewall, KVM,
  Blindplatten 1/2 HE, Notebook), `kit.kit.json` mit Ports/LEDs/Teilen/Einbau-Massen (glTF-Koordinaten).
  **gltf-transform optimize flacht die Hierarchie ab** (Overlays/PDUs/Deckel als Wurzel-Nodes, leere Nodes
  werden entfernt) -> `placement.js` haengt sie per Namenspraefix wieder an die Vorlage (alle im Ursprung).
- **Raum v3** `assets/out/room_v3.glb` (16.61 MB, `blender/lib/room_v3.py`, `blender/tasks/room_v3.py`):
  8 x 6 m, Beton, lange Seite Glasfront (Pfosten-Riegel), draussen Pflaster (PavingStones070) + heller
  Himmel (Emissive `sky_bright`), 2 Reihen a 4 Rack-Plaetze mit gelber Markierung + Kabeldurchfuehrung,
  Kaltgang mit Lochplatten, Tisch mit 3 Notebook-Plaetzen, Buerostuhl (`furniture.build_chair`, Fabric030,
  lib-Test `test_chair.py`). Slots im Manifest (`slots`, glTF-Koordinaten). Raum 0 Geraete.
  Sitzpunkt: Empty wird beim Optimieren entfernt -> Spiel nimmt die Oberkante der Sitzflaeche.
- **Kern** (`kern.js`/`embedded-kern.js`): Intents `install { item, slot }` / `{ item, rack, u }`,
  `uninstall { device }`, `trunk { a, b, item }`, `untrunk { device }`; Kern-IDs je Rolle in Einbau-Reihenfolge
  (sw1, pp1, nb1 ...; Rack bringt pdu = L, R); gekaufte Netzgeraete starten ohne Strom; `scenario.aufbau`/
  `kabel`/`trunks` fuer fertige Szenarien; `budget: null` = unbeschraenkt. Zustand enthaelt `placed`, `devices`.
- **Spiel**: `placement.js` (Klonen, Umbenennen, Geister-Vorschau gruen/rot, Zielwahl Rack-Platz / HE /
  Tisch-Platz), Neuaufbau der Geraete-Gruppe bei jeder Aenderung (Batch, Labels, Ports, Kabel, Displays),
  R = ausbauen (nur ohne Kabel; Rack nur leer), Stuhl (E: hinsetzen, Augenhoehe 1.17 m; im Sitzen E auf den
  Bildschirm = Notebook, sonst aufstehen), Trunk: in die Hand, E auf Patchpanel A, E auf B (anderes Rack),
  Buendel faellt hinten im Rack durch die Bodendurchfuehrung (CatmullRom, Klett alle 30 cm).
- **Levels**: L1-L7 starten leer mit Budget (leyoNET-Richtpreise) und `bauplan`; NB1 ist Admin-Laptop;
  neu `SB` (Sandbox, Budget unbeschraenkt) und `DEMO` (8 Racks, 146 Geraete, 78 Kabel, 2 Trunks).
- Tests: `npm run check` 167 OK (neu `check-install.ts`: Einbau/Ausbau/Trunk/Aufbau; `check-levels.ts`
  kauft+baut den Bauplan jedes Levels im Budget; `check-room.mjs` auf Raum v3). Browser (Playwright):
  Rack/Switch/PP/Notebook ueber die echte Zielwahl, Trunk, Stuhl, Demo-RZ 62 Draw Calls, 0 Fehler.
- **Offen**: Erstaufruf 25 MB (Raum 16.6 + Bausatz 5.5) = Konzept-Grenze -> Raum-Lightmap 2048 auf 1536
  oder Boden-Normal 1K pruefen; Kit-Geraete ohne Lightmap wirken etwas flach (Helligkeit im Browser
  abstimmen); Server haben keine Ports; Aussenbereich: Horizont-Kante sichtbar (Begruenung/Fernsicht).

## 2026-11-20 - Raum neu gebaut + Notebook-Detail + Inventar + Hosting-Vorbereitung

- **Raum neu gebaut** (`blender/tasks/test_room_rack_pbr.py` + `bake.OPTIMIZE_CMD`): Core-Switch U37
  (`cs1`), PSU-/PDU-Ports, neues Notebook. GLB **16.93 MB**, Raum **64'584 Tris** (Limit 300k),
  45 Lightmap-Materialien. Manifest: cs1 fw1 kvm1 nb1-3 pdu1-3 pp1-3 rt1 srv1-4 sw1-2.
- **Notebook-Detail-Pass** (`furniture.build_notebook`, Node-Namen unveraendert): Alu-Unibody mit
  gerundeten Ecken auf Gummifuessen, Tastenbeschriftung (Flat `key_legend` < 1 cm), Pfeil-T,
  Touchpad mit Diamantschliff-Kante + Fingerspuren (Regel 4, `touch_glass` wear 0.20), Lochraster-
  Lautsprecher, Scharnier-Walze, Ports mit Innenleben (RJ45-Kontakte/Rastnase, USB-3-Zungen, USB-C,
  HDMI, Laden + LED, Klinke, SD, Kensington), duenner Display-Rahmen mit Gummidichtung, Webcam mit
  Linse/IR/LED, rundes Deckel-Logo. 14.9k + 1.6k Tris pro Notebook (vorher ~3.7k; Limit 50k).
  Neues Material `rubber` (Plastic012A, dunkel -> kein eigenes Bild). Nahaufnahme: `blender/render/nb_close_turntable/`.
- **Inventar waehlbar:** Taste I = Fenster "Material" Tab Inventar (Karten anklicken = in der Hand,
  "Auto" = kuerzestes passendes Kabel), B = Tab Shop. Hotbar-Slots anklickbar, solange die Maus
  frei ist (Fenster offen); 1-9 / Mausrad wie bisher.
- **Bugfix Displays schwarz:** Screen-Quads hatten im GLB keine UVs (Export verwirft die UV-Map,
  weil `screen_dark` keine Textur hat) -> Canvas sampelte nur Pixel (0,0). `ui.attachScreens`
  erzeugt jetzt planare UVs, falls sie fehlen. Browser-Test: NB1 an zeigt Desktop, NB2/3 aus = schwarz.
- Tests: `npm run check` gruen (132 OK). Angepasst: `check-cables` (U37 heisst jetzt
  `r1_coreswitch_U37`), `check-embedded` (nur Port-LEDs muessen aus sein; System-LEDs eingeschalteter
  Geraete sind seit dem Strom-Feature an). Browser (Playwright, Scratchpad): Strom sw1/psu -> pdu3/01
  ack + pwr-LED an + Kabel sichtbar, Inventar-Klick/Hotbar-Klick, Notebook-Boot, Displays, 0 Konsolenfehler.
- **Hosting (erste Version) vorbereitet** - Upload selbst geht von der VM nicht (KONZEPT Kap. 11):
  - `vite.config.js` `base: './'` (Root oder Unterordner), Build `game/dist` ~19 MB (< 25 MB Budget).
  - `game/public/.htaccess` (landet in dist): MIME wasm/glb/ktx2, CSP ohne externe Quellen
    (`wasm-unsafe-eval` + `worker-src blob:` fuer Draco/KTX2-Decoder), HSTS, nosniff, DENY,
    Cache: index.html no-cache, `/assets/*` (Hash-Namen) 1 Jahr immutable, Deflate.
  - Deploy = PULL (Entscheid 2026-11-20, Variante A; Port 22 ist fuer GitHub gesperrt und bleibt es):
    Job `deploy-dev` in `.github/workflows/ci.yml` legt nach gruenen Checks auf develop
    `dev-dc.tar.gz` (+ `.sha256`, `version.txt`) ins Pre-Release `dev-latest`; der Server holt es per
    Plesk-Geplante-Aufgabe alle 5 Min. mit `scripts/dev-dc-pull.sh` (HTTPS ausgehend, Repo privat ->
    fine-grained Token "Contents: Read-only" als `github-token` neben dem Skript). Skript lokal gegen Mock-API
    getestet: Erst-Deploy, unveraendert = nichts, Update loescht alte Dateien nur in assets/ + decoders/.
  - Manuell (Plesk): Inhalt von `game/dist/` in den Dokumentstamm der Subdomain hochladen.
  - **LIVE seit 2026-11-20:** https://dev-dc.leyonet.ch (6479131). Plesk-Cron (vom Admin angelegt):
    `bash /var/www/vhosts/<abo>/deploy_leyoNET-DC/dev-dc-pull.sh
    /var/www/vhosts/<abo>/dev-dc.leyonet.ch`. Headless-Browser-Test live: laedt in
    4.6 s, Level-Menue, 0 Konsolen-/CSP-Fehler; MIME glb/wasm ok, CSP/nosniff/DENY/no-cache aktiv.
    Offen (klein): JS (1 MB) wird ohne gzip ausgeliefert, `/assets/` bekommt kein immutable-Cache,
    HSTS doppelt (Plesk setzt eigenen) -> .htaccess nachschaerfen. Token-Ablauf beachten.

## Fertig

- **Figur:** `assets/out/character.glb` - 7.57 MB, 21 Mixamo-Clips auf einer
  Armature (`mixamorig9:`), 49'960 Tris. walking/running/crouched_walking in place.
  Clip-Namen = Dateiname snake_case (`walking`, `running`, `crouch_idle_01`,
  `crouched_walking` ...), NICHT `walk`/`run` -> im Spiel Alias-Tabelle noetig.
  Task: `blender/tasks/character.py`, Kontrolle `blender/render/character_animations.png`.
- **Texturen (Realismus-Regel 2):** alle Materialien ambientCG-Sets
  (`blender/lib/textures.py`), Download per `python3 blender/fetch_ambientcg.py`
  nach `assets/textures/<id>/`. Flat nur noch LED-Emissives + Teile < 1 cm.
  Rack-Gehaeuse Brushed Steel (Metal009), Boden Plastic018A (Tile 60 cm), Waende Concrete030.
- **Run A (ORM-Migration):** pro Material Base Color JPG + Normal JPG + EINE ORM-JPG
  (R=AO, G=Roughness, B=Metallic). Groessenklassen: 2K nur Boden/Wand/Lochblech,
  sonst 1K. Tint-Bug behoben (helle Zielfarben bekommen eigene Albedo, dunkle ->
  baseColorFactor).
  - Testszene Raum + 1 Rack: `blender/tasks/test_room_rack_pbr.py`
  - raw 136.26 MB -> 44.98 MB (ORM) -> **40.85 MB** nach Draco + KTX2
    (`assets/out/test_room_rack_pbr.glb`), 26'779 Tris
  - Ziel < 20 MB **verfehlt** -> Run C
- **Tools:** KTX-Software 4.4.2 in `~/.local/opt`, Links `~/.local/bin/{ktx,toktx,ktxinfo}`
  (kein sudo auf der VM). Report-Skript: `python3 blender/glb_report.py <glb>`.

## Offen (Reihenfolge)

### Run C - Textur-Optimierung - ERLEDIGT 2026-11-19 (Option 1)
`assets/out/test_room_rack_pbr.glb`: 40.85 MB -> **19.03 MB** (Ziel < 20 MB erreicht), 26'781 Tris,
33 Bilder (25x 1K, 6x 2K, 2x 512). Normals UASTC (2K Boden/Wand bleiben), Rest + Lightmaps ETC1S.
- `textures.py`: ORM pro ambientCG-Set geteilt (`<asset>_shared_orm.jpg`, G auf max. Ziel-Rauheit
  des Sets normiert, B = 1), Material-Unterschied via Math-Multiply -> roughnessFactor/metallicFactor
  (lib-Test `blender/tasks/test_orm_shared.py`: Faktoren + Bild-Sharing im Export OK).
  Wear-Materialien behalten eigene ORM. ORM ueberall 1K. subfloor_concrete 2K (teilt Wand-Bilder),
  Glas-Smear-Sets 512.
- `bake.OPTIMIZE_CMD` (+ CLAUDE.md): optimize ohne Draco/Textur-Kompression, `--join/--palette/--instance
  false` -> uastc `--slots normalTexture` -> etc1s `--slots '!normalTexture'` -> draco ZULETZT
  (uastc/etc1s dekodieren Draco sonst). RDO wirkt bei Normals nicht (gltf-transform schaltet es fuer
  normalTexture ab) - daher entfernt.
- Gewicht jetzt: 2K-Normals Wand 5.2 MB + Boden 4.6 MB = Hauptposten. Naechster Hebel falls noetig:
  Boden-Normal 1K (Fliesen-Relief ist fein) oder Normal-Detail backen.
- Auffaellig (vorbestehend, schon in Run A): Lightmap `rack_1` hat coverage 0.0 / mean 0 -> Rack
  bekommt kein gebackenes Licht. Vermutlich Teil von ISSUE-001 Dunkelheit -> beim Ref-Vergleich pruefen.
- `.raw.glb` bewusst NICHT neu committet (Git-Aufraeumen offen), nur das optimierte GLB.

### Run B - Spielgeruest - ERLEDIGT 2026-11-19
`game/`: Vite 8.3.5 + three 0.170.0 (exakt gepinnt). `npm run dev -- --host 0.0.0.0`.
- `src/main.js`: Renderer (pixelRatio <= 1.5, ACES, sRGB), Platzhalter-Boden + 0.6-m-Raster,
  GLTFLoader mit Draco + KTX2 (Decoder self-hosted, `scripts/copy-decoders.mjs` -> `public/decoders/`,
  laeuft als predev/prebuild, gitignored). WASD relativ zum Yaw, Pointerlock, Shift rennen,
  C ducken (standing_to_crouch / crouch_to_standing als One-Shot), V third/ego (camPos.lerp,
  Kopf 1.62 m / geduckt 1.0 m, Figur im Ego unsichtbar), 1/2/3 = push/pickup/grab.
  FPS-Mittel alle 10 s in der Konsole.
- `src/character.js`: `CLIP_ALIAS` (walk -> walking usw.), Crossfade 0.2 s, One-Shots blockieren Bewegung.
- `npm run check`: headless Node-Test - 15 Alias-Clips binden (0 unbound), Hoehe 1.78 m,
  Zustandsmaschine ok; Hips-Drift walking/running/crouched_walking = 0.
- Nicht im Browser getestet (headless Firefox haengt auf der VM) -> visuell pruefen.
- Bundle 640 kB (ganzes three); Code-Splitting/Lazy-Imports spaeter.

### Spiel: Raum-Integration - ERLEDIGT 2026-11-19 (Branch develop)
- `game/src/room.js`: Raum-GLB (Draco + KTX2) geladen, Lightmap-Rekonstruktion nach bake.py
  (sRGB, Intensitaet x PI), PMREM-Environment, XZ-Kollision (Waende, Rack, Einhausung; Stirnseiten
  der Einhausung 0.9 m offen bis Schiebetueren per E oeffnen), Kamera-Kollision inkl. Glas,
  Blob-Schatten, Spawn vor der Einhausung.
- Tests: `npm run check` (Figur + Raum-Kollision, Node headless) und Browser-Check mit
  Playwright-Chromium (headless shell, SwiftShader): laedt fehlerfrei, ~15 FPS Software-Rendering.
  Playwright liegt NICHT im Repo (Scratchpad), Chromium in `~/.cache/ms-playwright`.
  Dev-Handle `window.__dc` nur im Dev-Server.
- bake.py: Lightmaps jetzt sRGB-kodiert (Banding-Fix, ISSUE-001 Teil-Fix). GLB 19.06 MB.
- ISSUE-002 (Rack-Lightmap leer) GELOEST: Ebenen-Lightmap-UV fuer Geraete, siehe docs/archiv/issues.md.
  GLB jetzt 19.14 MB, alle 32 Materialien mit Lightmap. Naechster Spielschritt laut Roadmap: Interaktion
  (Raycast aus Kameramitte, E-Taste, Port-Highlight, Einhausungs-Tueren) - braucht
  Devices-Retrofit (Ports/LEDs als benannte Nodes `<geraet>_led_p<nn>`).

### Devices-Retrofit - ERLEDIGT 2026-11-19 (KONZEPT Kap. 3)
- `blender/lib/retrofit.py`: Detail-Geometrie pro Geraetetyp per Cycles selected-to-active auf ein
  Low-Poly-Gehaeuse gebacken (Albedo/Rauheit/Metallic via EMIT, Normal tangent), Panel-Atlas
  front v 0..0.75 / rear 0.75..1, Cache `assets/build/devices/<typ>_*.png` per Geometrie-Hash.
  High wird vor dem Bake mit 0.5 mm / 2 Seg. gebevelt (sonst flache Normal-Map), Low hat den Bevel
  als Modifier (Realismus-Regel 1 jetzt auch fuer Geraete).
- Tris pro Geraet (Low + Overlays): switch 434 (vorher 1'846), server 406 (1'170), patchpanel 470
  (1'340), pdu_0u ~405 (1'722), pdu_1u 332 (652), blank 108 (120). Raum 26'914 -> 13'958 Tris.
- Overlays als Kind-Nodes (im GLB 171 LEDs, 162 Ports, 3 Displays, Namen eindeutig, Extras erhalten):
  `<geraet>_led_p<nn>` (eine LED pro Port: Link/Aktivitaet/Aus), `<geraet>_led_<func>` fuer
  System-LEDs (pwr, sys, fan, poe, mgmt, health, fault, bay01..08, psu1/2, nic1..4, switch, ok),
  `<geraet>_port_<nn>` (switch 01..24 oben ungerade/unten gerade, 25..28 SFP+, con, mgmt;
  patchpanel 01..24), `<geraet>_display` (7-Segment). Extras: leyonet_overlay, leyonet_port,
  leyonet_port_kind, leyonet_led_state. Nicht in der Lightmap (`room.split_overlays`).
- Texturgroessen (Entscheid 2026-11-19): **Boden 2K** (HPL + Lochblech; groesste Flaeche im
  Ego-Modus, spiegelt spaeter via PMREM), **Waende 1K**, **Devices 1K** (alle Panel-Atlanten
  1024 lange Seite, pdu_0u 64x1024). GLB `test_room_rack_pbr.glb` **15.55 MB**.
- Kontroll-Render `test_room_rack_pbr_front.png` zeigt jetzt die Rack-Elevation (ISSUE-004 geloest).
- Spiel, `game/src/batch.js` (Loader-Loesung, wie empfohlen): LEDs -> EINE InstancedMesh
  (Zustand = Instanzfarbe, HDR fuer Bloom, `room.batch.setLed(name, 'on'|'act'|'off')`),
  Ports -> EINE InstancedMesh, alle statischen Meshes pro Material zusammengefuehrt.
  `hitName(hit)`: instanceId -> `<geraet>_led_*`/`_port_*`, Merge-Treffer -> Quellobjekt.
  Eine InstancedMesh pro SZENE statt pro Geraet: pro Geraet waeren es 10+ Draw Calls nur fuer LEDs.
- Messung (Playwright + SwiftShader = Software-Rendering, nur relativ aussagekraeftig, 640x360):
  | Ansicht | Draw Calls | CPU in render() | FPS |
  |---|---|---|---|
  | Spawn third, ohne -> mit Buendeln | 139 -> 43 | 4.01 -> 2.16 ms | 1.89 -> 1.49 |
  | Rack Ego, ohne -> mit | 401 -> 27 | 4.43 -> 1.37 ms | 0.21 -> 0.59 |
  | Raum-Uebersicht (1280x720) | 47 -> 37 | - | - |
  SwiftShader ist fuellraten-/vertexgebunden; der leichte FPS-Rueckgang am Spawn kommt
  vermutlich vom verlorenen Pro-Objekt-Frustum-Culling der Merge-Meshes. Echte Messung auf
  dem Ziel-Laptop (Intel iGPU) steht aus. Vergleich jederzeit: Dev-Server mit `?nobatch`.
- Bugfix FPS-Log: mittelte das auf 0.1 s geklemmte dt statt Echtzeit -> bei langsamen Frames bis
  10x zu hoch (die frueher berichteten "~15 FPS" waren real ~1 FPS). Log zeigt jetzt auch
  Draw Calls und CPU-ms von render().
- Tests: `blender/tasks/test_retrofit_device.py -- <typ>` (Einzeltyp + Renders); Spiel: alle Port-
  und LED-Nodes per `scene.getObjectByName` adressierbar.
- Offen: Namens-Kollision `_led_pwr`/`_led_poe` beginnen ebenfalls mit `p` (Regex `_led_p\d\d`
  verwenden). Wear-Decals auf Geraeten (Regel 4) noch nicht. ~330 Overlay-Nodes pro Rack =
  viele Draw Calls -> im Spiel beim Laden zu InstancedMesh zusammenfassen (Interaktions-Schritt).
  ISSUE-004 (Task-Frontview schwarz).

### Wear-Decals Geraete (Realismus-Regel 4) - ERLEDIGT 2026-11-19
- `retrofit.WEAR`: pro Geraetetyp max. 3 Decals als reine ROUGHNESS-Variation im Panel-ORM
  (ambientCG CC0 Fingerprints002 Roughness / SurfaceImperfections015 Opacity), weicher Rand,
  |Delta| <= 0.12 (`WEAR_CAP`). Fingerabdruecke an Ohren/Griffen, Konsole, Patch-Feld, PDU-Schalter
  und -Breakern (glatter), feine Kratzer/Staub an Oberkanten, Label-Leiste, Blanks (rauer).
- Nachbearbeitung statt Neu-Bake: `<typ>_orm_base.png` (Bake) -> `<typ>_orm.png` (+ Wear), eigener
  Wear-Hash; Decal-Aenderungen backen nicht neu. Versatz deterministisch (crc32).
- Test `blender/tasks/test_wear_decals.py`: Limits geprueft (<= 3, Cap), Falschfarben-Delta-Karten
  pro Typ in `blender/render/test_wear_decals/`. Im Frontal-Render bewusst kaum sichtbar
  (Rauheit zeigt sich in Reflexen).
- Dabei gefunden + behoben: transponierter Atlas der pdu_0u legte die 1.7-m-Laenge auf die 64-px-
  Seite (26 mm/px, Front unscharf seit dem Retrofit) -> `retrofit.VERSION = 3`.
- Spuren sind pro TYP identisch (alle Switches gleich) - pro Instanz variieren braeuchte eigene
  Texturen; bei Bedarf spaeter per UV-Spiegelung/Offset.
- GLB 15.56 MB, Raum 13'958 Tris.

### Interaktion: E-Taste auf Ports - ERLEDIGT 2026-11-19 (Teil 1, KONZEPT Kap. 4)
- `game/src/interact.js` (`PortInteraction`): Raycast aus der Kameramitte gegen die Port-
  InstancedMesh + blickdichte Merge-Meshes (Glas/Geraete/Waende verdecken); anwaehlbar nur,
  wenn der Port das naechste Objekt ist und <= 1.3 m vom Kopf der Figur liegt (Third + Ego).
- Fadenkreuz + Prompt unter der Bildmitte ("r1_switch_U41 · Port 07 RJ45 — E: anwaehlen"),
  Hover-Marker (cyan), angewaehlt (orange, bleibt). E waehlt an/ab; Switch-Port: LED
  `<geraet>_led_p<nn>` Link <-> Aus (Startzustand aus den LED-Extras); Third-Person: Figur spielt
  `button_pushing`. `interact.selected` = Menge der angewaehlten Ports (Vorbereitung Kabel A -> B).
- Browser-Test (Playwright): Spawn -> kein Prompt (ausser Reichweite); Ego vor dem Rack: Hover
  `r1_switch_U41_port_07` in 0.72 m, E -> angewaehlt + LED aus -> Link, E -> ab + LED aus;
  Patchpanel `r1_patchpanel_U42_port_13` ebenso.
- Teil 2 (Kabelziehen) siehe unten; die An-/Abwaehl-Logik aus Teil 1 ist durch den Kabel-Zustand ersetzt.

### Interaktion: Kabelziehen Port A -> B - ERLEDIGT 2026-11-19 (Teil 2)
- `game/src/cables.js` (`CableManager`): E auf freien Port = Kabel anstecken (oranger Marker,
  Vorschau folgt der Hand / dem anvisierten Ziel), E auf kompatiblen freien Port = verbinden,
  E auf Port A oder Q = abbrechen, E auf belegten Port = abziehen.
- Kompatibel: RJ45 <-> Keystone (Kupfer), SFP+ <-> SFP+, Konsole <-> Konsole; sonst Hinweis
  "passt nicht: SFP+ -> Kupfer (RJ45)". > 5 m: "zu weit".
- "Gequantelte Kurve": Laenge rastet auf Patchkabel 0.25/0.5/1/1.5/2/3/5 m; Durchhang per
  Bisektion so, dass die CatmullRom-Kurve exakt diese Laenge hat (Regel 5: nie straff), gerader
  Auslauf 6 cm entlang der Port-Normalen, leichte Woelbung nach vorn; RJ45-Stecker an beiden Enden.
  Alle Kabel = EINE gemergte Mesh (Vertex-Farben), Vorschau = 1 weitere.
- Switch-Port-LEDs spiegeln den Kabelzustand (Link bei Kabel, sonst aus); beim Start werden die
  zufaelligen Bake-Zustaende der `_led_p<nn>` auf aus gesetzt. `cables.connections()` liefert
  die Verbindungen (fuer Szenario-Engine / WS-Bridge).
- Tests: `npm run check` (+ `check-cables.mjs`: Standardlaenge +-1 %, Durchhang > 0, gerader
  Auslauf, > 5 m abgelehnt) und Browser-Ablauf: Switch U41/07 -> Patchpanel U42/07 (0.25 m,
  LED Link), SFP 25 -> Keystone abgelehnt, Q bricht ab, Abziehen (LED aus).
- Kollision (2026-11-19): `deviceHulls()` = AABB pro Geraet (hoechster Vorfahre mit Praefix
  `r<n>_`/`rack_<n>_blank_`), Kurve alle ~1 cm gegen Huellen (+Kabelradius+2 mm) und Boden
  geprueft (je 5 cm Auslauf am Port ausgenommen). Ausweichen: Woelbung nach vorn in 2-cm-Schritten
  bis +30 cm, Durchhang je Schritt neu geloest (Laenge bleibt Standard), sonst naechste Laenge,
  sonst Ablehnung "kein freier Weg (<geraet> im Weg)". Route pro Port-Paar gecacht; Vorschau ohne
  Zielport ohne Kollisionssuche; blockierte Vorschau halbtransparent.
- Kabelbinder alle 30 cm (Regel 5), schwarzer Klett-Ring, nicht naeher als 8 cm am Stecker.
- Tests `check-cables.mjs`: synthetischer 15-cm-Kabelmanager (naiv kollidiert -> Route frei),
  geschlossene Wand -> abgelehnt mit Grund, Binder-Anzahl; echtes Rack (Roh-GLB, 29 Huellen):
  alle 216 Switch->Patchpanel-Paare frei. Befund: im aktuellen Raum kollidiert auch die naive
  Route nie (6 cm Auslauf > 25 mm Server-Bezel) - relevant ab Kabelmanagern / Mehr-Rack.
- Port-Marker (2026-11-19): Hover-Port x1.6, weich pulsierend 1.2 Hz (Deckkraft 0.45-0.7, nie 0);
  Cluster = alle Ports NUR des anvisierten Geraets in Reichweite (1.7 m), dezent 0.8 Hz
  (0.08-0.18), eine InstancedMesh; Kabel-Startport ruhig orange. Browser-Test: U41 -> 30 Ports,
  Blindplatte -> kein Cluster.
- Offen: Einhausungs-Tueren per E (bewusst NACH der WS-Bridge).

### Szenario-API (Spiel <-> Kern) - ERLEDIGT 2026-11-19 (Entwurf v1)
- `docs/SCENARIO_API.md`: Bezeichner (PortRef `r1_switch_U41/07`, LedRef `.../led_p07`), Intents
  `link`/`unlink`/`hello`, Antworten `ack`/`reject` (codes)/`state`/`delta`, Validierungs-Split
  Spiel (UI) vs. Kern (verbindlich), YAML-Zieltypen `link`/`link_any`/`no_loop`, offene Fragen.
- `game/src/kern.js` `LocalKern`: In-Browser-Kern mit denselben Regeln + Protokoll bis zur
  WS-Bridge. `CableManager` ist jetzt reine Darstellung: E -> Intent -> `kern.send()`; Kabel und
  LEDs nur aus `applyState(state)` (rev-geprueft). Ziele-HUD oben links (Dev-Szenario L1, 2 Ziele).
- Tests: `check-kern.mjs` (13 Faelle: ack/reject-Codes, LEDs, Ziele, rev) + Browser-Ablauf ueber den
  Kern (link ack rev 1 -> Kabel + LED + Ziel g1, unlink ack rev 2).
- E1-E3 umgesetzt (2026-11-19): Raum-Manifest beim Bake (`assets/out/test_room_rack_pbr.manifest.json`,
  sw1 = U41 ... pp1 = U42), `hello`-Handshake mit Validierung, Katalog-Modus mit Inventar (Dev-Szenario:
  0.25 m x3, 0.5 m x2, 1 m x1), Deltas mit `reason`/`by`, `injectFault()`; Vorschau bis ack.
  Browser-Loop getestet (verbinden -> Ziel, Stoerung -> Grund im HUD, erneut, abziehen).
- Naechster grosser Block: WS-Bridge (`WsKern`, MessagePack, JWT) - ersetzt nur `LocalKern`.

### Git-Aufraeumen - TEIL ERLEDIGT 2026-11-19 (0118767)
`*.raw.glb` per `git rm --cached` aus dem Index (Datei bleibt lokal); `assets/src/mixamo/` war
schon nicht getrackt. Weiter getrackt (braucht eigene Freigabe): `assets/src/ambientcg/` 453 MB,
`assets/textures/`, `assets/build/` (Teile), `blender/lib/__pycache__/`. Historie unveraendert
(kein Force-Push).

### Danach / zurueckgestellt
- Ref-Vergleich (5 Unterschiede, Fix 1+2, Vorher/Nachher nach `blender/render/compare/`)
  inkl. **ISSUE-001 Dunkelheit** (`docs/archiv/issues.md`: Environment, Bake, Tone Mapping).
  Keine Lichtfixes vor Run B.
- Realismus-Regel 4/5: `blender/lib/props.py` fertig + lib-getestet (3 Catmull-Rom-
  Patch-Buendel mit Durchhang + Kabelbinder alle 30 cm, Feuerloescher, Exit-Schild,
  Karton) - noch NICHT in `room.build_room_smb()` eingebaut, Renders von
  `test_props` noch nicht ausgewertet. Offen: Wear-Decals Geraete, Port-Nummern 1-24.
- AO-/Lightmap-Bake 256 Samples + `game/`-Post-Processing (Bloom, SSAO, PMREM, Bobbing).
  Offene Frage: glTF hat nur einen occlusionTexture-Slot, heute = Lightmap.
- Geraete haben noch keinen 0.5-mm-Bevel (Realismus-Regel 1).
