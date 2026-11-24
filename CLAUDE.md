# Projekt: leyonet DC Assets

## Regeln
- Blender nur headless: blender -b -P blender/tasks/<skript>.py
- Jedes Task-Skript MUSS am Ende rendern: Frontview + Turntable nach blender/render/
- Nach jedem Build: Polycount-Report (blender/check_mesh.py):
  max 50k Tris pro Device, max 300k pro Raum, sonst optimieren und erneut
- Nur Principled BSDF (PBR), Texturen von Poly Haven oder ambientCG (beide CC0) oder prozedural
- Export NUR via blender/lib/bake.py -> assets/out/*.glb, danach gltf-transform
  (Run C, UASTC/ETC1S-Split; massgeblich ist bake.OPTIMIZE_CMD, steht im *.bake.json):
  npx gltf-transform optimize in.glb tmp.glb --compress false --texture-compress false \
      --join false --palette false --instance false
  nice -n 19 npx gltf-transform uastc tmp.glb tmp.glb --slots normalTexture --level 2 --zstd 18 --jobs 2
  nice -n 19 npx gltf-transform etc1s tmp.glb tmp.glb --slots '!normalTexture' --jobs 2
  npx gltf-transform draco tmp.glb out.glb   (Draco zuletzt, sonst dekodieren uastc/etc1s es wieder)
  join/palette/instance aus: sonst gehen <geraet>_led_p<nn>-Nodes und LED-Materialien verloren.
  Figur (character.glb) nicht durch diese Kette (keine Draco/KTX2 noetig, < 8 MB).
- ORM wird pro ambientCG-Set geteilt (textures.py), Material-Unterschied via
  roughnessFactor/metallicFactor; nur Wear-Materialien haben eigene ORM. ORM immer 1K.
- Figuren: Mixamo-FBX importieren und als GLB exportieren. Nie selbst riggen.
- Bei Fehlern: Skript lesen, fixen, neu laufen lassen. Max 5 Iterationen, dann Stopp + Report.
- Neue lib-Funktionen immer zuerst einzeln testen (kleiner Task, ein Render), dann kombinieren.

## Realismus-Regeln (ab sofort für ALLE neuen und bestehenden Assets)

1. Kanten: Jedes Würfel-/Primitiv-Objekt bekommt einen Bevel-Modifier.
   Geraete/Detailteile: Bevel 0.0005 m (0.5 mm), 2 Segmente.
   Raeume/grosse Objekte: Bevel 0.002 m (2 mm), 3 Segmente.
   Kein Objekt darf eine scharfe, unbevelt Kante behalten.

2. Materialien: Nur echte PBR-Textur-Sets von ambientCG oder Poly Haven (CC0).
   Pro Material MUSS gesetzt sein: Base Color + Normal Map + Roughness Map.
   Reine Flat-Color-Materialien sind nur noch erlaubt fuer: LED-Emissives,
   Teilgroesse unter 1 cm. Roughness variiert leicht (Noise) bei grossen
   Flaechen - kein Material darf perfekt gleichmaessig glatt sein.

3. Scene-Realismus-Check: Am Ende jedes Raum-Builds den Prompt
   "Vergleiche mit docs/refs/" - Render vs. Referenzfoto, mind. 3 Unterschiede
   benennen und die Top-Fixes umsetzen.

4. Verschleiss-Pass: Bei Geraeten und Raeumen ein dezentes Wear-Decal
   (Fingerabdruecke, Staub, Kratzer als Roughness-Map-Variation), max. 3 pro
   Geraet, nie uebertrieben.

5. Kabel: Bündel immer mit CatmullRom-Kurven und leichtem Durchhang bauen,
   nie taut-gespannt. Kabelbinder-Elemente alle ~30 cm.

Vor dem Export gilt weiterhin: Polycount-Limits und bake.py-Regeln von oben.

## Projekt-Kontext
- Das Gesamtkonzept liegt in docs/KONZEPT.md - lies es vor grossen
  Aufgaben und halte dich an Architektur, Asset-Regeln und
  Arbeitsdisziplin (Kapitel 3 und 11) dort.
- Aktuelle Phase laut Konzept-Roadmap: "Raum v2" / danach "Charakter-Integration".
- Melde dich, wenn ein Auftrag aus dem Konzept eine Regel verletzen wuerde
  (Polycount, Namenskonventionen, Architektur) - statt still abzuweichen.

## Git-Workflow (ab sofort verbindlich)

- Remote: origin = git@github.com:vonam-git/leyoNET-DC.git
- Arbeitsbranch: develop (geht NICHT live; live auf dc.leyonet.ch geht nur main, User 2026-11-24). ALLE Commits und Pushes
  gehen auf develop: git checkout develop && git push origin develop
- main nur via Pull Request develop -> main (Branch-Schutz, KONZEPT Kap. 11).
  NIE direkt auf main committen oder pushen, keine Merges nach main ohne
  Auftrag des Users.
- Nach JEDEM abgeschlossenen Auftrag bzw. jedem sinnvollen Schritt:
  git add <nur die betroffenen Dateien> && git commit -m "<typ>: <was>"
  (Typen: feat, fix, perf, docs, checkpoint, chore = Wartung/Aufraeumen)
- Push nur auf origin develop: git push origin develop
- Vor jedem groesseren neuen Auftrag: "checkpoint"-Commit, damit
  Rollbacks einfach sind
- NIEMALS: git push --force, git reset --hard, git push origin main, Commit von
  blender/render/, node_modules/, .env oder grossen Binaerdateien
  ausserhalb assets/out/
- .gitignore pflegen, wenn neue Artefakt-Typen auftreten

### Was ins Git gehoert (Grundsatz, 2026-11-19)

- NUR Quellcode: blender/, game/, docs/, CLAUDE.md
- und optimierte Endprodukte: assets/out/*.glb, unter 30 MB je Datei
  (+ deren kleine JSON-Begleitdateien *.bake.json / *.manifest.json, die das Spiel importiert)
- NICHT: Roh-Downloads (assets/src/mixamo/, assets/src/ambientcg/), Roh-Exporte
  (*.raw.glb, *.opt.glb), Texturen-Rohmaterial (assets/textures/), Renders
  (blender/render/), Build-Zwischenstaende (assets/build/), node_modules/, __pycache__/
- Roh-Daten bleiben lokal und sind reproduzierbar (fetch_ambientcg.py, Mixamo-Download,
  Blender-Tasks). Bereits getrackte Pfade nur per git rm --cached entfernen, ohne
  Historien-Umbau.
