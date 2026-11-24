# KONZEPT.md - leyonet DC (Stand: laufendes Projekt)

Gesamtkonzept des 3D-Rechenzentrum-Spiels auf Basis des leyonet.ch-Kerns.
Dieses Dokument ist die zentrale Referenz fuer alle Bau-Auftraege.

---

## 1. Zielbild

Animierte Spielfigur (Third-Person GTA-artig, per V-Taste wechselbar in Ego-Perspektive) durchlaeuft virtuelle Serverraeume und Rechenzentren. Die Lernenden (Informatik EFZ) loesen realistische Auftraege:

1. **Einkauf**: Budget, Hardware-Katalog (Switche, Server, Kabel, PDUs)
2. **Einbau**: Geraete in 19"-Racks montieren (HE-Slots)
3. **Verdrahtung**: Patchkabel, Kabelmanagement, Farbstandards
4. **Konfiguration**: Konsole, VLANs, IP, Routing - ueber den leyonet-Kern
5. **Betrieb**: Stoerungen beheben (Netzteil, falsches Patchfeld, Loop)
6. **Ausbau**: KMU-Schrank -> Serverraum -> RZ-Halle -> Tier-III-Planung

**Architektur-Grundprinzip:** Der leyonet-Kern (Node.js, bestehend) ist die einzige Wahrheit (server-autoritativ). Das 3D-Spiel ist Darstellungsschicht. Jede Interaktion sendet Events (`{"action":"link","from":"sw1/p3","to":"srv2/eth0"}`), der Kern antwortet mit neuem Zustand. Punkte/Fortschritt/Budget berechnet NUR der Kern.

## 2. Tech-Stack

| Baustein | Entscheidung |
|---|---|
| Engine | Three.js (WebGL2), lazy imports, Tree-Shaking |
| Deployment | dc.leyonet.ch (dev-dc fuer develop-Branch), Plesk/Hetzner, alles self-hosted |
| Assets | Blender headless (Claude Code baut), Draco + KTX2, GLB |
| Figur | Mixamo (FBX, With Skin, In Place), Merge zu character.glb |
| Kommunikation | WebSocket (MessagePack/CBOR), Delta-Updates 10 Hz, Interesse-Filter |
| Auth | JWT 15 min + Refresh, Zod-Validierung, Rate-Limit |
| Daemon | PM2 hinter Plesk-nginx Reverse-Proxy |

## 3. Grafik-Philosophie

Stilisierter Realismus statt AAA-Fotorealismus, weil Zielhardware = BYOD-Schul-Laptops mit Intel-iGPU. Erreicht durch:

- Echte PBR-Textur-Sets von ambientCG/Poly Haven (CC0): immer Albedo + Normal + Roughness
- Baked Lighting: AO + Lightmaps (Cycles CPU, samples 256), keine Echtzeit-Schatten in grossen Raeumen
- Bevel auf allen Grundkoerpern (0.5 mm Geraete / 2 mm Raum)
- Detail-Geometrie (Ports, Vent-Schlitze, Schrauben) GEBAKT als Normal/Albedo/Roughness-Maps, NICHT als Mesh
- Emissive-LEDs mit Bloom (threshold 1.0, strength 0.35)
- ACESFilmicToneMapping, PMREM-Environment fuer Reflexionen (glossy Raised Floor!)
- Wear-Decals dezent, Kabelbuendel mit CatmullRom-Durchhang, Alltagsobjekte
- Referenz-Loop: Renders gegen docs/refs/ vergleichen, Top-Differenzen iterativ fixen
- Three.js-Post: Bloom, SSAO (nur ab Quality HIGH, Intel-iGPU +3-4 ms einplanen), Kamera-Bobbing im Ego-Modus (0.02 m, 1.8 Hz)

### Asset-Regeln (verbindlich, in CLAUDE.md gepflegt)

1. Polycount: max 50k Tris pro Geraet (Ziel < 2k durch Textur-Details), max 300k pro Raum
2. LEDs sind IMMER separate Emissive-Quads, Namenskonvention `<geraet>_led_p<nn>` (dynamisch schaltbar im Spiel: Link/Aktivitaet/Aus)
3. Massstab: 1 Blender-Einheit = 1 m, 19"-Norm: RACK_W 0.483, U_H 0.0445
4. Export NUR via bake.py -> assets/out/, danach gltf-transform (Draco)
5. Qualitaetsstufen HIGH/MEDIUM/LOW beim Spielstart, GPU-Detection

## 4. Spiel-Grundgeruest

- WASD relativ zur Blickrichtung, Pointerlock, Maus fuer Yaw
- Perspektivenwechsel V: third <-> first, weich per `camPos.lerp`, im Ego-Modus Figur unsichtbar (Kopfhoehe 1.62 m)
- AnimationMixer mit Zustandsmaschine: idle/walk/run/crouch_* mit Crossfade 0.2 s nach Geschwindigkeit; grab/pickup/push als einmalige Trigger-Aktionen (bewegung pausieren, Clip abspielen, zurueck)
- Interaktion: Raycast aus Kameramitte, E-Taste, Port-Highlight; Kabelziehen: Klick A -> gequantelte Kurve -> Klick B
- LOD, Frustum/Occlusion Culling, InstancedMesh fuer Masse-Geraete

## 5. Figur (Mixamo)

Kern-Set: idle, walk, run, crouch_enter/idle/walk/exit (Walk/Run/CrouchWalk MIT In Place!), grab, pickup, push, sit, react_look, thumbsup. Optional: waving, clap. Download IMMER: FBX Binary, With Skin, 30 fps, Key Frame Reduction None. Merge zu assets/out/character.glb unter 8 MB, Clips heissen wie Dateinamen ohne Endung.

## 6. Szenario-Engine

Szenarien als YAML im Kern (nicht im Spiel): budget, raum, ziele, hardware_katalog, fehler_injektion (z.B. psu-defekt), didaktik (Nachweis EFZ). Progression Level 1-5 (KMU-Schrank bis Tier-III). Sandbox-Modus frei.

## 7. Gamification

XP + Bindaester ("Patch-Azubi" -> "RZ-Architekt"), Badges (Farbcode-Sauber, Loop-Killer), Budget als Kernmechanik, Timer-Modi, Zertifikat-PDF pro Szenario (Portfolio!).

## 8. Datenschutz (revDSG)

Pseudonyme statt Klarnamen, keine Analytics, kein externes CDN, Avatare nicht aus Fotos, Leaderboard optional/klassenweise, Loeschkonzept: Session-Daten 24 h, Reports 90 Tage, Fortschritt Semesterende + 3 Monate, Audit-Log 2 Jahre; naechtlicher Loesch-Job, Backup-Rotation max 30 Tage, Datenschutzerklaerung auf dc.leyonet.ch. Zuordnung Pseudonym->Person liegt NUR offline bei der Lehrperson.

## 9. Sicherheit und Betrieb

- Client sendet Absichten, nie Ergebnisse; JWT + Zod + Rate-Limit
- Naechtlicher Audit-Agent (Claude Code per Cron 03:30): npm audit, OWASP ZAP, Header-Check (CSP default-src 'self', HSTS, X-Frame-Options...), Lighthouse >= 90, k6 50 Sessions P95 < 100 ms, DSG-Check, Loeschfrist-Kontrolle. Bericht an info@leyonet.ch, bei kritisch Deploy-Stopp
- Fehlerreport: In-Game-Button (Kategorie, Freitext, Screenshot, FPS, Szenario-ID, Pseudonym) -> SMTP info@leyonet.ch; window.onerror gebuendelt; naechtlicher Digest, kritisch = Sofortmail
- Admin-Konsole dc.leyonet.ch/admin: Lehrpersonen-Accounts + TOTP, Rollen Admin/Lehrperson, Audit-Log, Session-Tabelle (Pseudonym, Klasse, Szenario, Status) mit Schliessen/Freigeben/Sperren/Live-Beobachtung, Statistik-Heatmap + CSV-Export, Onboarding-Wizard, Unterrichts-Presets (Klassenstart/Zwischenstopp/Schluss)
- Quality Gates pro Deploy: Lighthouse >= 90, FPS 60 (Grenze 30, Auto-LOW), Frame-Budget 8 ms + 2 ms, TTI < 5 s. Gate scheitert = Deploy stoppt + Mail

## 10. Traffic-Budget

Erstaufruf < 25 MB, Folgestart < 2 MB (Draco, KTX2, Lazy Loading, Brotli, Hash-Cache-Namen, Service Worker). Laufzeit < 5 KB/s pro Spieler: State-on-change, Delta 10 Hz quantisiert, MessagePack, Interesse-Filter, Heartbeat 30 s.

## 11. Arbeitsdisziplin (fuer alle Agent-Runs)

- Ein Auftrag = eine Sache, Renders zur Selbstpruefung, max 5 Iterationen
- VOR jedem groeseren Auftrag Checkpoint-Commit, danach Commit mit Ergebnis
- Reihenfolge global: Raum fertig -> Devices-Retrofit -> Figur -> Spielgeruest -> Interaktion -> WS-Bridge -> Szenarios -> Admin
- Git: pushes nur auf develop, main nur via PR (Branch-Schutz)
- VM ist Quarantäne: kein Plesk/Domain-Zugriff, Deploy-Key nur fuer dieses Repo

## 12. Roadmap

| Phase | Inhalt | Status |
|---|---|---|
| Setup VM | Skript, Claude Code, Blender headless | erledigt |
| Devices v1 | rack, server, switch, patchpanel, pdu | erledigt (v1) |
| Raum v2 | ambientCG-Texturen, Raised Floor, Referenz-Loop | laufend |
| Devices-Retrofit | Textur-Details + LED-Namenskonvention | geplant |
| Figur | Mixamo-Import, character.glb | Downloads bereit |
| Spielgeruest | main.js, Kamera, Steuerung, Perspektiven | Basis existiert in game/ |
| Charakter-Integration | AnimationMixer, Zustandsmaschine | naechster grosser Schritt |
| Interaktion + Kabel | Raycast, E, Patchen | danach |
| WS-Bridge | leyonet-Kern anbindung | danach |
| Szenarios + Gamification | Level 1-5 | danach |
| Admin + Betrieb | Konsole, Audits, Fehlerreport | parallel spaet |
