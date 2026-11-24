# Offene Issues

Format: ID, Status, gefunden in, betroffen, Ursachen, Pruefung. Issues werden im
Referenz-Vergleich (Realismus-Regel 3) explizit abgehakt.

---

## ISSUE-001 - Raum-Renders zu dunkel, Metallflaechen fast schwarz

- **Status:** offen - bewusst NICHT vor Run B fixen (Entscheid 2026-11-18)
- **Gefunden:** Run A (ORM-Migration), Renders `blender/render/test_room_rack_pbr_pbr_{front,side,total}.png`
- **Symptom:** Gesamte Szene sehr dunkel; Brushed Steel (Rack-Gehaeuse
  `rack_brushed`, Containment `brushed_steel`) wirkt fast schwarz statt hell
  metallisch. Referenzen (`docs/refs/`) zeigen helle Raeume mit hellem
  Boden/Decke und deutlich sichtbaren Reflexen.
- **Nicht die Ursache:** ORM-Packing. Export-Test 2026-11-18 bestaetigt:
  Roughness = G, Metallic = B werden korrekt als `metallicRoughnessTexture`
  exportiert und im Blender-Material korrekt verdrahtet.

### Ursachen (zu pruefen)

1. **Environment**
   - `blender/tasks/test_room_rack_pbr.py:30` setzt die World-Strength auf `0.0`
     (gewollt fuer einen sauberen Lightmap-Bake, aber damit auch fuer die PBR-Views).
   - Metall (metallic 1.0) hat keinen Diffus-Anteil, es zeigt nur, was es spiegelt.
     Ohne Environment spiegelt es Beton- und Deckenflaechen bei geringer Leuchtdichte,
     also wirkt es schwarz.
   - Im Spiel fehlt dafuer noch die PMREM-Environment-Map (KONZEPT Kap. 3, Auftrag
     "Post-Processing" Punkt 2: Raum-HDR via bake.py als EXR).
2. **Bake / Lichtmenge**
   - Einzige Lichtquellen sind die 3 LED-Baender (`room.build_led_band`, Emission
     `led_diffuser` 40, Diffusor nur 48 mm breit). Fuer einen 4 x 5 x 3 m Raum mit
     Sichtbeton (Albedo um 0.3) ist das wenig Licht. In den Referenzen gibt es
     Rasterleuchten bzw. breite Lichtbaender und helle Decken/Boeden.
   - Der Lightmap-Bake laeuft im Test mit `samples=64`
     (`test_room_rack_pbr.py:72`), KONZEPT Kap. 3 verlangt 256. Das ist eher Rauschen
     als Helligkeit, muss aber fuer den Vergleich gleichgezogen werden.
   - Der Bake ist reine Irradiance (DIFFUSE direct + indirect). Spiegelndes Licht auf
     Metall kommt im GLB nur ueber die Environment-Map (siehe 1).
3. **Tone Mapping / Belichtung**
   - Blender: `AgX` + Look `AgX - Medium High Contrast` (`blender/lib/render.py:21-22`)
     ohne Exposure-Korrektur. Der High-Contrast-Look drueckt die Schatten zusaetzlich ab.
   - Spiel: `ACESFilmicToneMapping`, Exposure 1.1 (KONZEPT/Post-Processing-Auftrag).
     Die Renders sind also nicht 1:1 mit dem Spielbild vergleichbar.
   - Pruefen: Blender-Renders mit derselben Kurve wie das Spiel (Filmic/ACES-aehnlich,
     Exposure angeglichen), sonst bewertet der Ref-Vergleich die falsche Kurve.

### Teil-Fix 2026-11-19 (Spiel-Integration Raum)

- Lightmap-Kodierung: 8 bit LINEAR liess den Grossteil des Raums auf ~3 Stufen
  (`mean_encoded` 0.011 bei Skala p99.5) -> grobes Banding/Treppen im Spiel. bake.py
  kodiert jetzt mit sRGB-Kurve (`extras.lightmap_encoding = "srgb"`), Spiel dekodiert per
  `lightMap.colorSpace = SRGBColorSpace`. Ergebnis: glatte Verlaeufe, `mean_encoded` 0.040.
- Spiel: PMREM-Environment (RoomEnvironment, Intensitaet 0.35) als Zwischenloesung fuer
  Metall-Reflexe, bis ein gebackenes Raum-HDR existiert.

### Pruefung im Ref-Vergleich (nach Run A + B)

- [ ] Environment: Render mit Raum-Environment (World > 0 bzw. HDR) vs. ohne,
      Metallhelligkeit Rack/Containment vergleichen
- [ ] Bake: Leuchten-Leistung/Flaeche gegen Referenzen plausibilisieren, Bake mit 256 Samples
- [ ] Tone Mapping: Blender-Kurve an Spiel-Kurve (ACES, Exposure 1.1) angleichen,
      dann erst Helligkeit gegen `docs/refs/` beurteilen
- [ ] Ergebnis: Mittlere Bildhelligkeit Render vs. Referenz (Luminanz-Histogramm) dokumentieren

---

## ISSUE-002 - Lightmap-Bake fuer das Rack ist leer

- **Status:** GELOEST 2026-11-19
- **Gefunden:** Run A, bestaetigt in Run C (`rack_1`: `coverage 0.0`, `mean_encoded 0.0`, kein Fehler)
- **Mindest-Test:** `blender/tasks/test_rack_lightmap.py` - nur das Rack, nur AO-Bake, Pruefung in
  der Reihenfolge (1) UV-Map `Lightmap` aktiv + in 0..1 + Flaeche > 0, (2) Bake-Image-Node
  `LM_TARGET` mit Bake-Image und aktiv, (3) Selektion/Sichtbarkeit beim Bake; danach PNG
  Pixel-fuer-Pixel (Alpha = geschrieben vs. RGB = schwarz), Float-Buffer UND neu eingelesenes PNG.
- **Ergebnis vorher:** (2) 20/20 OK, (3) 30/30 OK, **(1) 0/30**: UV1 lag bei 0.02..7.08, UV-Flaeche
  ~0. Pixel: 0 von 262'144 mit Alpha > 0 -> nie geschrieben (nicht schwarz).
- **Ursache:** Die Box-Projektion erzeugt bei Geraeten ~1 UV-Insel pro Flaeche (9'633 Inseln
  bei 10'238 Flaechen; Raumschale: 390). `bpy.ops.uv.pack_islands` muss pro Insel einen festen
  Rand halten, das passt nicht in 0..1 -> Inseln auf Flaeche 0 geschrumpft und ueber ~4x4
  UDIM-Kacheln verteilt. Cycles schreibt nur in 0..1 -> leerer Bake, ohne Fehlermeldung.
- **Fix (`bake.py`, `uvtools.py`):**
  - `unwrap_lightmap(method="auto")`: erst pack_islands (jetzt `udim_source="ACTIVE_UDIM"` +
    vorher gemeinsam auf 0..1 normalisiert); faellt die Flaeche unter 5 % oder verlaesst sie
    0..1 -> `uvtools.plane_lightmap`: ein Rechteck pro (Objekt, Seite, Tiefenebene), eigener
    Regal-Packer mit festem Pixelrand. Rack: 1'135 Rechtecke, Fuellung 0.55 bei 1024 px.
  - `check_lightmap_uv()` vor jedem Bake, und `bake_lightmap` bricht ab, wenn KEIN Texel
    geschrieben wurde - nie wieder ein still leerer Bake.
- **Ergebnis nachher:** AO-Test 67'544 Texel geschrieben, alle 30 Objekte mit Texeln, PNG ==
  Float-Buffer. Szene: `rack_1` coverage 0.337, mean_encoded 0.150. UV-Ueberlappung (Raster-
  Pruefung) 4.8 % der Texel - koplanare, sich im Modell durchdringende Flaechen (Ports in der
  Front), gleiche Lage -> gleiches Licht, vertretbar.
- **Spiel:** Workaround `SKIP_LIGHTMAP_GROUPS` geleert, alle 32 Materialien mit Lightmap.

---

## ISSUE-003 - Lightmap-Texel-Ueberlappung im Rack (4.8 %)

- **Status:** AKZEPTIERT 2026-11-19 - Re-Check beim Devices-Retrofit
- **Gefunden:** ISSUE-002-Fix (Raster-Pruefung der UV1 `Lightmap` nach `uvtools.plane_lightmap`)
- **Befund:** 1'230 von 25'481 abgedeckten Texeln (4.8 %) liegen unter mehr als einer Flaeche,
  433 Flaechen-Paare. Ursache: koplanare, sich im Modell durchdringende Flaechen derselben
  Tiefenebene (z. B. Port-Gehaeuse buendig in der Frontplatte).
- **Warum akzeptiert:** Die Flaechen liegen am selben Ort -> praktisch gleiche Einstrahlung,
  kein sichtbarer Fehler im Spiel-Screenshot.
- **Re-Check:** Nach dem Devices-Retrofit (Ports/Vents als Textur statt Geometrie) muss die
  Ueberlappung sinken; Pruefung mit dem Raster-Skript aus ISSUE-002 wiederholen.
- **Re-Check 2026-11-19 nach Retrofit:** Rack-Lightmap 317 statt 1'135 Rechtecke, Fuellung 0.66.
  Ueberlappung 8'625 von 271'252 Texeln = **3.2 %** (vorher 4.8 %), 548 Flaechen-Paare.
  Rest: Low-Poly-Boxen, die sich beruehren (Ohren/Chassis, Patchpanel-Rueckteile). Bleibt akzeptiert.

---

## ISSUE-004 - Task-Frontview `test_room_rack_pbr_front.png` ist schwarz

- **Status:** GELOEST 2026-11-19 - `render.render_front(front=..., isolate=True, studio=True)`:
  Kamera, Bildausschnitt und Studio-Licht relativ zur Objekt-Bounding-Box entlang der
  Frontachse; `render.front_axis(rack)` leitet die Achse aus der Rack-Rotation ab (hier +X).
  Robust gegen kuenftige Rotationen; Default `front=-Y` = bisheriges Verhalten.
- **Status vorher:** offen (vorbestehend, nicht durch das Retrofit)
- **Ursache:** `render.render_front()` blickt entlang +Y; das Rack ist um 90 Grad gedreht (Front
  zeigt nach +X). Die Kamera steht bei y = -1.7 m hinter der Vorderwand -> nur Wand-Rueckseite.
- **Fix-Idee:** `render_front(..., axis="x")` bzw. Kamera aus der Rack-Rotation ableiten, oder
  `clip_start` bis kurz vor das Rack. Bis dahin gelten die Geraete-Fronten aus
  `blender/tasks/test_retrofit_device.py` und `pbr_front` als Kontroll-Renders.

---

## ISSUE-005 - Sichtbare Trennlinien zwischen Patchpanel-Keystones

- **Status:** IST-FEATURE (Entscheid 2026-11-19) - NICHT fixen
- **Befund:** Feine senkrechte Linien zwischen benachbarten Keystone-Gehaeusen im gebackenen
  Patchpanel-Panel (0.5-mm-Bevel der Gehaeuse, 1.7 mm Abstand).
- **Begruendung:** Echte Patchpanels haben sichtbare Trennlinien zwischen den Modulen - gewollt.
