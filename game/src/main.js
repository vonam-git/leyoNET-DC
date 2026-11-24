import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
// Figur vorerst AUS (User-Entscheid 2026-11-19): reine Ego-Perspektive. Code bleibt, CHARACTER = true
// (mit lokaler assets/out/character.glb) bringt Third-Person (V), Mixamo-Figur und Aktionen 1/2/3 zurueck. Abweichung von KONZEPT Kap. 1/4/5.
const CHARACTER = false;
// Plan v3: leerer Raum v3 + Bausatz (Geraete werden gekauft und zur Laufzeit eingebaut)
import roomUrl from '../../assets/out/room_v3.glb?url';
import kitUrl from '../../assets/out/kit.glb?url';
import kitJson from '../../assets/out/kit.kit.json';
import { CharacterAnimator } from './character.js';
import { prepareRoom, resolveCollisions } from './room.js';
import { batchRoom } from './batch.js';
import { addGraffiti } from './graffiti.js';
import { setOwnEnv } from './unify.js';
import { PortInteraction } from './interact.js';
import { CableManager, deviceHulls } from './cables.js';
import { HARDWARE, KIT_ENV, Placement } from './placement.js';
import { addPortLabels } from './labels.js';
import * as leyonet from '@leyonet/core'; // Simulationskern (vendor/leyonet, AGPL-3.0-or-later)
import { RoomManifest, reduceState } from './kern.js';
import { EmbeddedKern } from './embedded-kern.js'; // leyoNET-Simulationskern (vendor/leyonet)
import { verbundLevel } from './verbund.js';
import { LEVELS, levelById, readyScenario } from './levels.js';
import { GameUI, toast } from './ui.js';
import { drawPlan, drawRoomMap, drawWall, fitView, planModel, roomMapScale, THEME } from './netplan.js';
import { SpeedTimer } from './timer.js';
import { Classroom, errorText } from './classroom.js';
import { initTouch } from './touch.js';
import { VERSION } from './info.js';
import { ACTIONS, normCode, pixelRatio, QUALITY, Settings } from './settings.js';
import { buildSave, checkSave, compareMark, MAX_FILE, parseSave, saveName, saveSize, sizeText } from './saves.js';
import { Unlock } from './freischaltung.js';
import { openHelp, openSaves, openSettings, openUnlock, openWelcome } from './menus.js';
import './style.css'; // Designsystem
// Raum-Manifest (E1): liegt beim Kern; LocalKern laedt es hier stellvertretend
import roomManifest from '../../assets/out/room_v3.manifest.json';

// Level / Szenarien: game/src/levels.js (spaeter YAML im Kern - docs/SCENARIO_API.md Kap. 5)
let currentLevel = null;

const log = import.meta.env.DEV ? console.log.bind(console) : () => {}; // Diagnose nur im Dev-Server

// ---------- Konstanten ----------
const SPEED = { walk: 1.5, run: 4.0, crouch: 0.9 }; // m/s
const HEAD_H = 1.62; // Kopfhoehe Ego-Modus
const HEAD_H_CROUCH = 1.0;
const HEAD_H_SIT = 1.17; // Augenhoehe sitzend (Stuhl 0.47 m)
const THIRD_DIST = 2.6;
const CAM_MARGIN = 0.2; // Abstand der Third-Person-Kamera zu Waenden
const PLAYER_R = 0.25; // Kollisionsradius der Figur
const THIRD_H = 1.7;
const CAM_LERP = 8; // 1/s, Glaettung camPos.lerp
const TURN_LERP = 12; // 1/s, Figur dreht sich in Laufrichtung
const MOUSE_SENS = 0.0022;

// ---------- Einstellungen + Zugangscode ----------
const settings = new Settings(undefined, () => applySettings());
const unlock = new Unlock();

// ---------- Renderer / Szene ----------
const aaNow = QUALITY[settings.quality].aa; // nur beim Erzeugen waehlbar
const renderer = new THREE.WebGLRenderer({ antialias: aaNow, powerPreference: 'high-performance' });
renderer.setPixelRatio(pixelRatio(settings.quality, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1d22);
scene.fog = new THREE.Fog(0x1b1d22, 25, 60);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.05, 200);

// Reflexionen (Metall!) ueber PMREM; bis ein gebackenes Raum-HDR existiert: RoomEnvironment.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;
// Lightmaps tragen das diffuse Licht im Raum; Hemi nur als Grundlicht (Figur, Rack ohne Bake).
const hemi = new THREE.HemisphereLight(0xdfe6ff, 0x3a3530, 1.4);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(4, 8, 3);
scene.add(sun);

// Boden (Platzhalter bis der Raum-GLB geladen wird)
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshStandardMaterial({ color: 0x5b5f66, roughness: 0.85, metalness: 0.0 }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const grid = new THREE.GridHelper(60, 100, 0x30343a, 0x464a52); // 0.6 m = Raised-Floor-Raster
grid.position.y = 0.002;
scene.add(grid);

// Blob-Schatten unter der Figur (keine Echtzeit-Schatten, KONZEPT Kap. 3)
const blob = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.9),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.005;
  m.renderOrder = 1;
  scene.add(m);
  return m;
})();

// ---------- Loader (Draco + KTX2 fuer die Raum-/Geraete-GLBs) ----------
const draco = new DRACOLoader().setDecoderPath('./decoders/draco/');
const ktx2 = new KTX2Loader().setTranscoderPath('./decoders/basis/').detectSupport(renderer);
const loader = new GLTFLoader().setDRACOLoader(draco).setKTX2Loader(ktx2);

// ---------- Input ----------
const keys = new Set();
let yaw = 0;
let pitch = -0.15;
let firstPerson = !CHARACTER;
let crouched = false;

addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (classroom.blocked) { e.preventDefault(); return; }
  if (ui?.open) {
    if (e.code === 'Escape') ui.close();
    return; // Fenster offen: keine Bewegung, kein E
  }
  if (e.ctrlKey || e.altKey || e.metaKey) return; // Browser-Befehle (Strg+R usw.) sind keine Spieltasten
  const act = settings.actionOf(e.code);
  if (act) e.preventDefault(); // Zeichen nicht ins neu fokussierte Eingabefeld tippen, Leertaste/Pfeile nicht scrollen
  if (!ui) return; // Raum laedt noch
  if (act && WINDOW_ACTIONS[act]) { WINDOW_ACTIONS[act](); return; }
  keys.add(normCode(e.code));
  if (e.code === 'KeyV' && CHARACTER) togglePerspective();
  if (act === 'crouch') toggleCrouch();
  if (CHARACTER && e.code === 'Digit1') triggerAction('push');
  if (CHARACTER && e.code === 'Digit2') triggerAction('pickup');
  if (CHARACTER && e.code === 'Digit3') triggerAction('grab');
  if (!CHARACTER && /^Digit[1-9]$/.test(e.code)) selectSlot(Number(e.code.slice(5)) - 1);
  if (act === 'use') useTarget();
  if (act === 'cancel') cancelCable();
  if (act === 'remove') removeSfp();
});
addEventListener('keyup', (e) => keys.delete(normCode(e.code)));
const down = (action) => keys.has(settings.keys[action]);
const needLevel = (fn) => () => openUi(() => (currentLevel ? fn() : ui.openLevels()));
const WINDOW_ACTIONS = {
  shop: needLevel(() => ui.openShop('Shop')),
  inventory: needLevel(() => ui.openShop('Inventar')),
  levels: () => openUi(() => ui.openLevels()),
  plan: needLevel(() => ui.openPlan()),
  verbund: () => openVerbund(),
  map: () => nextMap(),
  timer: () => { timer.toggle(); flash(timer.enabled ? 'Speedrun-Timer ein' : 'Speedrun-Timer aus', 1400); },
  help: () => openUi(() => openHelp(ui, settings)),
  hints: () => { settings.set('hints', !settings.hints); flash(settings.hints ? 'Tastenhinweise ein' : `Tastenhinweise aus – ${settings.key('hints')} blendet sie wieder ein`, 2200); },
};
addEventListener('wheel', (e) => {
  if (ui?.open || !hotbarItems.length) return;
  const k = hotbarItems.indexOf(room.cables.selected ?? null);
  selectSlot((k + (e.deltaY > 0 ? 1 : -1) + hotbarItems.length) % hotbarItems.length);
}, { passive: true });

// ---------- Inventar-Leiste: welches Kabel/Modul als naechstes verwendet wird ----------
const hotbarEl = document.getElementById('hotbar');
let hotbarItems = []; // [null (= Auto), item, ...]
function selectSlot(k) {
  if (!room?.cables || k >= hotbarItems.length) return;
  selectItem(hotbarItems[k]);
}
/** Artikel in die Hand nehmen (null = Auto) - Hotbar, Mausrad und Inventar-Fenster */
function selectItem(item) {
  if (!room?.cables) return;
  room.cables.selected = item;
  room.cables._routes?.clear?.();
  renderHotbar(room.kernState);
}
// Hotbar anklickbar, solange die Maus frei ist (Fenster offen / kein Pointer-Lock)
hotbarEl.addEventListener('mousedown', (e) => {
  const s = e.target.closest('.slot');
  if (!s) return;
  e.preventDefault();
  e.stopPropagation();
  selectSlot(Number(s.dataset.k));
  ui?.refresh();
});
function renderHotbar(st) {
  if (!st || st.modus !== 'katalog') { hotbarEl.innerHTML = ''; hotbarItems = []; return; }
  const have = currentLevel.scenario.hardware_katalog.filter((c) => (st.inventory?.[c.item] ?? 0) > 0);
  if (room.cables.selected && !have.some((c) => c.item === room.cables.selected)) room.cables.selected = null;
  hotbarItems = [null, ...have.slice(0, 8).map((c) => c.item)];
  const sel = room.cables.selected ?? null;
  const slot = (k, item, body) => `<div class="slot ${item === sel ? 'on' : ''}" data-k="${k}"><kbd>${k + 1}</kbd>${body}</div>`;
  hotbarEl.innerHTML = slot(0, null, '<span class="sw auto"></span><span class="nm">Auto</span>')
    + have.slice(0, 8).map((c, i) => slot(i + 1, c.item, `<span class="sw" style="background:${c.farbe}"></span>`
      + `<span class="nm">${esc(c.kurz ?? (c.typ === 'sfp' ? c.modul : c.typ === 'stromkabel' ? `Strom ${c.laenge} m` : `${c.laenge} m`))}</span>`
      + `<b>×${st.inventory[c.item]}</b>`)).join('');
}
addEventListener('blur', () => keys.clear());

// Rechte Maustaste halten = zoomen (Plan v4)
const FOV = 65;
const FOV_ZOOM = 24;
let zoomHeld = false;
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mouseup', (e) => { if (e.button === 2) zoomHeld = false; });
// Linksklick = E (benutzen), sobald die Maus gefangen ist; der erste Klick faengt nur die Maus ein
renderer.domElement.addEventListener('mousedown', (e) => {
  if (e.button === 2) { zoomHeld = !ui?.open; return; }
  if (e.button !== 0 || ui?.open) return;
  if (document.pointerLockElement === renderer.domElement) useTarget();
  else renderer.domElement.requestPointerLock();
});

// ---------- Oberflaeche (Notebook, Shop, Level) ----------
let ui = null;
function openUi(fn) {
  keys.clear();
  if (document.pointerLockElement) document.exitPointerLock();
  fn();
}
// Esc (Plan v4): Der Browser gibt mit Esc die Maus frei -> ohne offenes Fenster das Hauptmenue zeigen
document.addEventListener('pointerlockchange', () => {
  // Maus wird erst nach dem Oeffnen eines Fensters gefangen (schliessen + sofort wieder oeffnen): freigeben
  if (classroom.blocked) { if (document.pointerLockElement) document.exitPointerLock(); return; }
  if (document.pointerLockElement && ui?.open) { document.exitPointerLock(); return; }
  if (document.pointerLockElement || !ui || ui.open || touch.active) return;
  openMenu();
});
function openMenu() {
  openUi(() => ui.openMenu({
    resume: () => {},
    levels: () => ui.openLevels(),
    plan: () => (currentLevel ? ui.openPlan() : ui.openLevels()),
    saves: () => showSaves(() => openMenu()),
    saveHint: classroom.canSave ? 'auf dem Server oder als Datei' : 'als Datei herunterladen',
    settings: () => showSettings(() => openMenu()),
    help: () => openHelp(ui, settings, { onBack: () => openMenu() }),
    timer,
    classroom,
    restart: currentLevel ? () => (currentLevel.verbund ? openVerbund(true) : startSession(currentLevel.id, currentReady)) : null,
    verbund: () => verbundInfo(),
    openVerbund: () => openVerbund(),
  }));
}
document.getElementById('source')?.prepend(`v${VERSION} · `);
// Touch (Plan v4 J)
const touch = initTouch(renderer.domElement, {
  look: (dx, dy) => {
    const sens = MOUSE_SENS * 1.9 * (camera.fov / FOV);
    yaw -= dx * sens;
    pitch = THREE.MathUtils.clamp(pitch - dy * sens, -1.3, firstPerson ? 1.3 : 0.6);
  },
  use: () => { if (ui && !ui.open) useTarget(); },
  cancel: () => cancelCable(),
  remove: () => removeSfp(),
  zoom: (on) => { zoomHeld = on; },
  crouch: () => toggleCrouch(),
  menu: () => ui && openMenu(),
  shop: () => ui && WINDOW_ACTIONS.shop(),
  inventory: () => ui && WINDOW_ACTIONS.inventory(),
  plan: () => ui && WINDOW_ACTIONS.plan(),
});

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cap = (id) => `<kbd>${esc(settings.key(id))}</kbd>`;
let lastPrompt = null;
// ---------- Willkommen, Einstellungen, Spielstaende, Zugangscode ----------
function applySettings() {
  renderer.setPixelRatio(pixelRatio(settings.quality, window.devicePixelRatio));
  document.getElementById('hud').hidden = !settings.hints;
  const f = document.getElementById('fps');
  f.hidden = !settings.fps;
  document.getElementById('hud-keys').innerHTML = `<span>${['forward', 'left', 'back', 'right'].map(cap).join('')} gehen</span><span>${cap('run')} rennen</span><span class="extra">${cap('crouch')} ducken</span>`
    + `<span><kbd>RMT</kbd> zoomen</span><span>${cap('use')}/<kbd>Klick</kbd> benutzen</span><span><kbd>1–9</kbd> Hand</span><span class="extra">${cap('cancel')} abbrechen</span><span>${cap('remove')} ausbauen</span>`
    + `${ACTIONS.filter((a) => a.hint).map((a) => `<span${['map', 'timer', 'verbund'].includes(a.id) ? ' class="extra"' : ''}>${cap(a.id)} ${a.hint}</span>`).join('')}<span><kbd>Esc</kbd> Menü</span>`;
  lastPrompt = null; // Prompt mit neuen Tasten zeichnen
  if (room?.kernState && currentLevel) renderGoals(room.kernState);
  if (ui) { ui.drawScreens(); verbundChanged(); }
}
navigator.keyboard?.getLayoutMap?.().then((m) => { settings.layout = m; applySettings(); }, () => {});
const showWelcome = () => openUi(() => openWelcome(ui, { settings, levels: () => ui.openLevels(), open: () => showSaves(showWelcome), openSettings: () => showSettings(showWelcome), openHelp: () => openHelp(ui, settings, { onBack: showWelcome }) }));
function showSettings(onBack) {
  openSettings(ui, settings, { onBack, aaNow, timer, stats: () => ({ fps: live.fps, ms: live.ms, width: renderer.domElement.width, height: renderer.domElement.height, calls: renderer.info.render.calls }) });
}
function askCode(level, onOk, onBack) { openUnlock(ui, { unlock, title: level.title, onOk, onBack }); }

const levelIds = () => LEVELS.map((l) => l.id);
function makeSave() {
  const p = player?.position;
  return buildSave({ version: VERSION, level: currentLevel.id, ready: currentReady, intents: classroom.log, state: room.kernState, ms: timer.ms, player: p ? [p.x, p.z, yaw, pitch].map((v) => +v.toFixed(3)) : null });
}
function downloadSave(save) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(save)], { type: 'application/json' }));
  a.download = saveName(save);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return a.download;
}
/** Speichern: mit Klasse auf dem Server; zu gross / voll / nicht erreichbar / ohne Klasse -> Datei */
async function storeSave() {
  const save = makeSave();
  const size = saveSize(save);
  const asFile = (why) => ({ text: `${why}Als Datei gespeichert: ${downloadSave(save)} (${sizeText(size)}).` });
  if (!classroom.canSave) return asFile('');
  if (size > classroom.saveMax - 512) return asFile(`Der Spielstand ist zu gross für den Server (${sizeText(size)}, möglich sind ${sizeText(classroom.saveMax)}). `);
  try {
    const r = await classroom.storeSave(save);
    return { text: `Auf dem Server gespeichert (${sizeText(size)}).`, saves: r.saves, max: r.max };
  } catch (e) { return asFile(`${errorText(e.message)} `); }
}
const saveLevelError = (id) => (!classroom.levelOpen(id) ? 'Dieses Level ist für deine Klasse noch nicht offen.' : null);
async function loadSave(save, run = null) {
  if (room.loading) return; // Doppelklick
  const level = levelById(save.level);
  if (!unlock.open(level)) { askCode(level, () => loadSave(save, run), () => showSaves()); return; }
  room.loading = true;
  ui.close();
  try {
    await startSession(save.level, save.ready, null, { save, run });
    const b = room.bounds;
    if (save.player && player) {
      const [x, z, y, p] = save.player;
      if (x > b.min.x && x < b.max.x && z > b.min.z && z < b.max.z) {
        player.position.set(x, 0, z);
        resolveCollisions(player.position, PLAYER_R, room.colliders);
        yaw = y;
        pitch = THREE.MathUtils.clamp(p, -1.3, 1.3);
        snapCamera = true;
      }
    }
    const diff = compareMark(save, room.kernState);
    flash(diff ?? 'Spielstand geladen', diff ? 7000 : 2600, diff ? 'err' : 'ok');
    if (!run && classroom.joined && currentLevel.scenario.ziele?.length) flash('Dieser Spielstand zählt nicht für die Klasse.', 5000);
  } finally { room.loading = false; }
}
function showSaves(onBack = null) {
  const lv = currentLevel;
  const text = async (p) => { try { return await p; } catch (e) { throw new Error(errorText(e.message)); } };
  const full = classroom.log.length >= 20_000;
  openUi(() => openSaves(ui, {
    current: lv && !lv.verbund && room.kernState && !full ? { title: `${lv.title}${currentReady ? ' (fertig aufgebaut)' : ''}`, steps: classroom.log.length } : null,
    why: !lv ? 'Es läuft noch kein Level.' : lv.verbund ? 'Verbundaufgaben liegen laufend auf dem Server, du musst nichts speichern.' : 'Dieser Stand hat zu viele Schritte und lässt sich nicht mehr speichern.',
    canServer: classroom.canSave,
    title: (s) => `${LEVELS.find((l) => l.id === s.level)?.title ?? s.level}${s.ready ? ' (fertig aufgebaut)' : ''}`,
    list: () => text(classroom.listSaves()),
    store: () => storeSave(),
    download: () => `Als Datei gespeichert: ${downloadSave(makeSave())}.`,
    remove: (id) => text(classroom.deleteSave(id)),
    openServer: async (id) => {
      const r = await text(classroom.openSave(id));
      const c = checkSave(r.save, levelIds());
      if (c.error) throw new Error(c.error);
      await loadSave(c.save, r.run);
    },
    openFile: async (f) => {
      if (f.size > MAX_FILE) throw new Error('Die Datei ist zu gross für einen Spielstand.');
      const c = parseSave(await f.text(), levelIds());
      const err = c.error ?? saveLevelError(c.save.level);
      if (err) throw new Error(err);
      await loadSave(c.save);
    },
    onBack,
  }));
}

// Speedrun-Timer (Taste T, Menue): laeuft ab Levelstart, stoppt beim letzten Ziel
const timer = new SpeedTimer(document.getElementById('timer'));

// ---------- Klasse (Plan v4 F) ----------
const lockEl = document.getElementById('classlock');
const classroom = new Classroom({
  getState: () => ({ level: currentLevel?.id ?? null, goals: room?.kernState?.goals ?? [], kern: room?.kernState }),
  onChange: () => {
    const text = classroom.blocked;
    if (text && lockEl.hidden) { keys.clear(); touch.reset(); zoomHeld = false; if (document.pointerLockElement) document.exitPointerLock(); }
    lockEl.hidden = !text;
    lockEl.querySelector('p').textContent = text ?? '';
    document.getElementById('observed').hidden = !classroom.observed;
    const t = classroom.joined ? classroom.info.settings?.timer : 'frei';
    timer.setForce(t === 'ein' ? true : t === 'aus' ? false : null);
    verbundChanged();
  },
});

// ---------- Minikarte + Wandbildschirm (Plan v4 C + I) ----------
const mapEl = document.getElementById('minimap');
const mapCanvas = mapEl.querySelector('canvas');
const mapArrow = mapEl.querySelector('i');
const darkMode = matchMedia('(prefers-color-scheme: dark)');
const MAPS = ['raum', 'plan', 'aus'];
let mapMode = 'raum';
let mapView = null; // Abbildung Welt -> Karte fuer den Pfeil (nur im Modus Raum)
const mapLast = { x: NaN, z: NaN, yaw: NaN };
function nextMap() {
  mapMode = MAPS[(MAPS.indexOf(mapMode) + 1) % MAPS.length];
  mapEl.classList.toggle('off', mapMode === 'aus');
  drawMap();
}
mapEl.addEventListener('click', () => nextMap());
darkMode.addEventListener('change', () => drawMap());
/** Hintergrund der Karte: nur bei Aenderungen (Zustand, Modus, Groesse) - nie pro Frame. */
function drawMap() {
  mapView = null;
  mapArrow.hidden = mapMode !== 'raum';
  if (!room?.plan || mapMode === 'aus') return;
  const w = mapEl.clientWidth, h = mapEl.clientHeight;
  const dpr = Math.min(devicePixelRatio, 2);
  mapCanvas.width = Math.round(w * dpr);
  mapCanvas.height = Math.round(h * dpr);
  const g = mapCanvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const theme = darkMode.matches ? THEME.dark : THEME.light;
  if (mapMode === 'plan') drawPlan(g, room.plan, fitView(room.plan, w, h, { max: 1, pad: 46 }), { w, h, theme, small: true, empty: 'Netzplan: noch leer' });
  else {
    drawRoomMap(g, { w, h, theme, bounds: room.bounds, racks: room.placement.rackColliders(), desks: room.supports });
    mapView = roomMapScale({ w, h, bounds: room.bounds });
    mapLast.x = NaN;
  }
}
/** Pfeil jedes Frame verschieben (Compositor, kein Zeichnen, kein Layout). */
function moveMapArrow() {
  if (!mapView || !player) return;
  const { x, z } = player.position;
  if (x === mapLast.x && z === mapLast.z && yaw === mapLast.yaw) return;
  Object.assign(mapLast, { x, z, yaw });
  mapArrow.style.transform = `translate(${mapView.X(x).toFixed(2)}px, ${mapView.Y(z).toFixed(2)}px) rotate(${(-yaw).toFixed(4)}rad)`;
}
/** Bildschirm an der Wand: eigene Flaeche knapp vor dem Display-Modell, Canvas-Textur mit dem Netzplan. */
function makeWall(root) {
  const o = root.getObjectByName('wall_display_screen');
  if (!o) return null;
  const bb = new THREE.Box3().setFromObject(o);
  const size = bb.getSize(new THREE.Vector3());
  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = Math.round((1600 * size.y) / size.z);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size.z, size.y), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  mesh.material.color.setScalar(0.86); // Panel-Helligkeit: nicht heller als das Tageslicht draussen
  mesh.name = 'wall_plan';
  mesh.position.set(bb.min.x - 0.002, (bb.min.y + bb.max.y) / 2, (bb.min.z + bb.max.z) / 2); // rechte Wand, Blick -x
  mesh.rotation.y = -Math.PI / 2;
  scene.add(mesh);
  return { mesh, canvas, tex };
}
function updatePlan(st) {
  room.plan = planModel(st);
  if (room.wall) {
    const { canvas, tex } = room.wall;
    drawWall(canvas.getContext('2d'), room.plan, { w: canvas.width, h: canvas.height, title: currentLevel?.title ?? '' });
    tex.needsUpdate = true;
  }
  drawMap();
}
function wallHover() {
  const h = room?.interact?.lastHit;
  return !!(h && h.distance <= 3.5 && /^wall_display/.test(h.name ?? ''));
}

addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  const sens = MOUSE_SENS * (camera.fov / FOV); // gezoomt: feiner zielen
  yaw -= e.movementX * sens;
  pitch -= e.movementY * sens;
  pitch = THREE.MathUtils.clamp(pitch, -1.3, firstPerson ? 1.3 : 0.6);
});

// ---------- Raum ----------
let room = null; // { colliders, cameraBlockers, spawn, ... }
let snapCamera = true; // erster Frame (und nach Spawn): Kamera direkt aufs Ziel, nicht lerpen

async function loadRoom() {
  const [gltf, kitGltf] = await Promise.all([loader.loadAsync(roomUrl), loader.loadAsync(kitUrl)]);
  scene.add(gltf.scene);
  room = prepareRoom(gltf.scene); // Kollider / Kamera-Blocker VOR dem Buendeln (Originale)
  room.baseColliders = room.colliders;
  // Sitzpunkt: Empty chair_1_sit verwirft gltf-transform (leerer Node) -> aus der Sitzflaeche (Oberkante, Mitte)
  const seat = gltf.scene.getObjectByName('chair_1_seat');
  if (seat) {
    const bb = new THREE.Box3().setFromObject(seat);
    room.chair = { pos: new THREE.Vector3((bb.min.x + bb.max.x) / 2, bb.max.y, (bb.min.z + bb.max.z) / 2),
      // Blick zum Tisch (Stuhl steht vor der Tischplatte)
      facing: room.supports[0] ? room.supports[0].getCenter(new THREE.Vector3()) : null };
  } else room.chair = null;
  room.wall = makeWall(gltf.scene);
  addGraffiti(gltf.scene, renderer.capabilities.getMaxAnisotropy());
  room.static = batchRoom(gltf.scene); // Raum: statisch, einmal gebuendelt
  scene.remove(ground, grid);
  scene.fog = null;
  hemi.intensity = 0.6;
  sun.intensity = 0;
  log(`[room] ${room.colliders.length} Kollider, Lightmaps ${room.stats.lightmapped} Materialien,`,
    `${roomManifest.slots?.length ?? 0} Slots`, JSON.stringify(room.static.stats));
  room.placement = new Placement({ scene, kitScene: kitGltf.scene, kit: kitJson, slots: roomManifest.slots ?? [], trays: roomManifest.trays ?? null });
  room.cables = new CableManager({ scene, batch: room.static, getHand, hulls: [], supports: room.supports });
  ui = new GameUI({
    kern: () => room.kern, state: () => room.kernState, level: () => currentLevel, levels: LEVELS,
    // jedes Fenster gibt die Maus frei (Pointer-Lock leitet sonst Klicks an die 3D-Flaeche) und stoppt Bewegung
    onOpen: () => { keys.clear(); touch.reset(); if (document.pointerLockElement) document.exitPointerLock(); },
    onClose: () => { if (!touch.active) renderer.domElement.requestPointerLock?.(); },
    onLevel: (id, ready) => startSession(id, ready),
    selected: () => room.cables?.selected ?? null,
    onSelectItem: (item) => selectItem(item),
    levelOpen: (id) => classroom.levelOpen(id),
    codeOpen: (level) => unlock.open(level),
    onHome: () => showWelcome(),
    onLocked: (level) => askCode(level, () => ui.chooseStart(level), () => ui.openLevels()),
    settings,
  });
  applySettings();
  classroom.init();
  rebuildDevices([]);
  // Level-Start erst, wenn Kabel, Oberflaeche und Interaktion stehen (?level=L1 ueberspringt das Menue)
  const params = new URLSearchParams(location.search);
  const want = params.get('level');
  if (!want) showWelcome();
  else if (unlock.open(levelById(want))) startSession(want, params.get('start') === 'fertig');
  else openUi(() => ui.onLocked(levelById(want)));
}

/** Plan v3: Geraete-Gruppe aus der Kern-Liste `placed` neu aufbauen und alles daran haengen. */
function rebuildDevices(placed) {
  const root = room.placement.buildDevices(placed);
  room.placedKey = JSON.stringify(placed.map((p) => [p.node, p.vorlage]));
  const hulls = deviceHulls(root);
  room.labels?.removeFromParent();
  room.interact?.dispose();
  room.batch = batchRoom(root);
  room.labels = addPortLabels(scene, room.batch);
  room.cables.rebind(room.batch, hulls);
  room.colliders = [...room.baseColliders, ...room.placement.rackColliders()];
  room.interact = new PortInteraction({
    scene, camera, batch: room.batch, occluders: [...room.static.merged, ...room.batch.merged],
    getHead: () => headPos.set(player?.position.x ?? 0, eyeHeight(), player?.position.z ?? 0),
    onUse: (hover) => {
      const ev = room.cables.use(hover);
      if (!ev) return null;
      room.interact.mark(room.cables.pending?.index ?? null);
      if (ev.action === 'invalid') {
        flash(ev.text, 2600, 'err');
        return ev;
      }
      if (ev.action !== 'intent') {
        log('[cable]', ev.action, ev.port ?? '');
        return ev;
      }
      // Intent an den Kern; Kabel/LEDs erscheinen erst mit dem Zustand (onMessage)
      room.kern.send(ev.intent).then((res) => {
        const it = ev.intent;
        log('[kern]', res.type, it.action, it.from ?? it.port, it.to ?? '', res.reason ?? `rev ${res.rev}`);
        room.cables.resolve(res); // K11: Vorschau erst jetzt weg
        room.interact.mark(room.cables.pending?.index ?? null);
        if (res.type === 'reject') flash(res.reason, 3200, 'err');
      });
      return ev;
    },
  });
  ui.screens.clear();
  ui.attachScreens(room.batch.screens, (node) => room.cables.manifest?.byNode.get(node)?.id ?? null);
  log('[devices]', placed.length, 'eingebaut', JSON.stringify(room.batch.stats));
}

// ---------- Figur ----------
let player = null; // THREE.Group (gltf.scene)
let anim = null;
const stateEl = document.getElementById('state');

function togglePerspective() {
  firstPerson = !firstPerson;
  if (player) player.visible = !firstPerson; // Ego: Figur unsichtbar
}

function toggleCrouch() {
  if (anim?.busy) return;
  crouched = !crouched;
  if (!anim) return; // Ego ohne Figur: nur die Augenhoehe wechselt
  if (crouched) anim.trigger('crouch_enter', 'crouch_idle');
  else anim.trigger('crouch_exit', 'idle');
}

const headPos = new THREE.Vector3();
const promptEl = document.getElementById('prompt');
const crosshairEl = document.getElementById('crosshair');

const handPos = new THREE.Vector3();

/** Hand / Kabelende ohne Zielport: Treffer vor dem Fadenkreuz in Reichweite, sonst 0.5 m vor dem Kopf. */
function getHand() {
  const head = headPos.set(player?.position.x ?? 0, eyeHeight(), player?.position.z ?? 0);
  return handPos.copy(head).addScaledVector(lookDir, 0.5);
}

const goalsEl = document.getElementById('goals');

function renderGoals(st) {
  const goals = st.goals ?? [];
  const done = goals.filter((g) => g.done).length;
  const num = currentLevel.verbund ? '★'.repeat(currentLevel.sterne) : currentLevel.id.replace(/^L/, '');
  const title = currentLevel.title.replace(/^Level \d+ - |^Verbund ★+ /, '');
  // Verbund: viele Ziele -> nur die naechsten offenen
  const shown = currentLevel.verbund ? [...goals.filter((g) => !g.done).slice(0, 6)] : goals;
  const rest = currentLevel.verbund ? goals.filter((g) => !g.done).length - shown.length : 0;
  const rows = shown.map((g) => `<div class="goal ${g.done ? 'done' : ''}"><span class="tick"></span><span>${esc(g.text)}</span></div>`).join('');
  let chips = '';
  if (st.modus === 'katalog') {
    const have = currentLevel.scenario.hardware_katalog.filter((c) => (st.inventory?.[c.item] ?? 0) > 0)
      .map((c) => `<span class="chip"><span class="dot" style="background:${c.farbe}"></span>${esc(c.name)} <b>×${st.inventory[c.item]}</b></span>`);
    chips = `<div class="hud-chips"><span class="chip">Budget <b>${st.unlimited ? '∞' : `CHF ${(st.budget ?? 0).toFixed(2)}`}</b></span>${have.join('')
      || `<span class="chip">Inventar leer – <kbd>${esc(settings.key('shop'))}</kbd> Shop</span>`}</div>`;
  }
  goalsEl.innerHTML = `<div class="hud-level"><div class="hud-badge">${num}</div><div><div class="hud-title">${esc(title)}</div>`
    + `<div class="hud-sub">${done} von ${goals.length} Zielen · ${currentLevel.verbund ? `<kbd>${esc(settings.key('verbund'))}</kbd> Auftrag` : `<kbd>${esc(settings.key('levels'))}</kbd> Level`}</div></div></div>`
    + `<div class="hud-progress"><i style="width:${goals.length ? (100 * done) / goals.length : 0}%"></i></div>${rows}${rest > 0 ? `<div class="hud-sub">… und ${rest} weitere</div>` : ''}${chips}`;
  // alle Ziele erfuellt -> einmal pro Sitzung feiern
  if (goals.length && done === goals.length && !room.celebrated) {
    room.celebrated = true;
    if (currentLevel.verbund) { flash('Alle Ziele erfüllt – bereit für die Abnahme!', 5000, 'ok'); return; }
    const run = timer.stop();
    const verdict = classroom.joined ? classroom.finish() : null; // Server spielt das Protokoll nach
    const k = LEVELS.indexOf(currentLevel);
    setTimeout(() => openUi(() => ui.showDone(currentLevel, LEVELS[k + 1], timer.enabled ? run : null, verdict)), 600);
  }
}

const levelKey = (id, ready) => `${id}${ready ? '+' : ''}`; // Bestzeiten getrennt: L2 = selbst aufgebaut, L2+ = fertig aufgebaut
let currentReady = false;

// ---------- Verbundsaufgabe (Klasse): freigegeben von der Lehrperson, Standort bauen, Abnahme ----------
const vbEl = document.getElementById('verbund');
const verbundInfo = () => (classroom.joined && classroom.info.verbund) || null;
vbEl.addEventListener('click', () => openVerbund());
let vbSeen = null; // zuletzt gezeigte Freigabe / Abnahme
let vbResult = null;
function verbundChanged() {
  const v = verbundInfo();
  const here = !!(v && currentLevel?.verbund && classroom.vb && currentLevel.id === v.task);
  vbEl.hidden = !v || here || !v.open;
  if (v && !vbEl.hidden) vbEl.innerHTML = `<b>${'★'.repeat(v.sterne)}</b> Verbundaufgabe «${esc(v.titel)}» – <kbd>${esc(settings.key('verbund'))}</kbd> ${v.running ? 'weiterbauen' : 'beginnen'}`;
  if (v?.open && vbSeen !== v.round && !here) { vbSeen = v.round; flash(`Neue Verbundaufgabe: ${v.titel}`, 4000, 'ok'); }
  if (here) room.kern?.setPartner?.(v.partner ?? null);
  if (here && !v.open && vbSeen !== `zu${v.round}`) { vbSeen = `zu${v.round}`; flash('Die Lehrperson hat die Verbundaufgabe geschlossen – neue Schritte zählen nicht mehr.', 5000, 'err'); }
  if (v?.result && vbResult !== v.result.at) {
    const first = vbResult === null && !here;
    vbResult = v.result.at;
    if (!first && ui) openUi(() => ui.showAbnahme(v, currentLevel?.verbund ? currentLevel : null));
  }
}
classroom.onVerbundLost = () => flash(`Diese Aufgabe läuft auf einem anderen Gerät oder wurde neu gestartet – mit ${settings.key('verbund')} weiterbauen.`, 6000, 'err');
function openVerbund(askAgain = false) {
  const v = verbundInfo();
  if (!v) { flash('Keine Verbundaufgabe freigegeben (Menü → Klasse).', 2400); return; }
  if (currentLevel?.verbund && classroom.vb && !askAgain) {
    openUi(() => ui.openAuftrag(currentLevel, { check: () => classroom.checkVerbund(), result: v.result ?? null, partner: v.partner }));
    return;
  }
  if (!v.open) { flash('Die Verbundaufgabe ist geschlossen.', 2400, 'err'); return; }
  openUi(() => ui.openVerbundStart(v, async (fresh) => {
    let r;
    try { r = await classroom.startVerbund(fresh); } catch (e) { return errorText(e.message); }
    ui.close();
    await startSession(verbundLevel(r.task, r.seat), false, r);
    openUi(() => ui.openAuftrag(currentLevel, { check: () => classroom.checkVerbund(), result: verbundInfo()?.result ?? null, partner: r.partner }));
    classroom.refresh();
    return null;
  }));
}

/** Sitzung mit dem Kern: hello -> Manifest pruefen (E1) -> Zustand + Deltas rendern (E3). */
// verbund: { intents, partner } vom Server; load: { save, run } Spielstand (run = Lauf des Servers oder null)
async function startSession(levelId, ready = false, verbund = null, load = null) {
  const intents = verbund?.intents ?? load?.save.intents ?? [];
  room.kern?.stopGoals?.();
  if (!verbund) classroom.leaveVerbund();
  currentLevel = verbund ? levelId : levelById(levelId);
  currentReady = !!ready;
  const scenario = ready ? readyScenario(currentLevel) : currentLevel.scenario; // Plan v4 E
  room.kern = new EmbeddedKern({ manifest: roomManifest, scenario, kit: kitJson });
  if (verbund) { room.kern.partner = verbund.partner ?? null; room.kern.deferGoals(); }
  classroom.setRun(load?.run ?? null); // der Lauf des verlassenen Levels gilt nicht mehr
  classroom.record(room.kern, intents);
  standUp();
  room.kernState = null;
  room.celebrated = false;
  timer.reset();
  room.cables.reset(); // Kabel/Vorschau des vorigen Levels weg, neuer Kern-Zustand ab rev 0
  room.interact?.mark(null);
  const early = []; // Nachrichten vor Abschluss von hello puffern (Manifest noch nicht gesetzt)
  const handle = (msg) => {
    if (!room.cables.manifest) {
      early.push(msg);
      return;
    }
    const next = reduceState(room.kernState, msg);
    if (next === room.kernState) return;
    room.kernState = next;
    // Plan v3: Ein-/Ausbau -> voller Zustand mit neuer Geraeteliste: Manifest + Geraete-Gruppe neu
    if (msg.type === 'state' && msg.placed) {
      const key = JSON.stringify(msg.placed.map((p) => [p.node, p.vorlage]));
      room.cables.manifest = new RoomManifest({ ...roomManifest, devices: msg.devices ?? [] });
      if (key !== room.placedKey) rebuildDevices(msg.placed);
    }
    room.cables.applyState(next);
    const tk = JSON.stringify(next.trunks ?? []);
    if (tk !== room.trunkKey || msg.type === 'state') {
      room.trunkKey = tk;
      room.placement.drawTrunks(next.trunks, (id) => room.cables.manifest?.byId.get(id)?.node);
    }
    updatePlan(next);
    renderGoals(next);
    renderHotbar(next);
    ui.refresh();
    // E3: vom Kern entfernte Kabel mit Grund anzeigen (nicht bei eigenem Abziehen)
    const foreign = (msg.links_remove ?? []).filter((r) => r.by !== 'player');
    if (foreign.length) flash(foreign.map((r) => r.reason).join(' · '), 4000);
  };
  room.kern.onMessage(handle);
  const res = await room.kern.send({ action: 'hello', scenario: currentLevel.scenario.id, client: { version: 1 } });
  if (intents.length) { early.length = 0; await room.kern.resume(intents); }
  if (load) { const g = room.kern.goals(); room.celebrated = g.length > 0 && g.every((x) => x.done); } // schon geschafft: nicht nochmals feiern
  const manifest = new RoomManifest(res.manifest);
  room.cables.setSession({ manifest, modus: res.modus, catalog: res.catalog });
  for (const m of early.splice(0)) handle(m);
  if (intents.length) handle(room.kern.state());
  const missing = room.cables.manifest.validate(room.batch.ports.userData.names);
  if (missing.length) console.error('[kern] Manifest passt nicht zu den Geraeten, fehlende Port-Nodes:', missing);
  flash(currentLevel.title, 3000);
  if (currentLevel.scenario.ziele?.length && classroom.joined && !verbund && !load) classroom.startRun(currentLevel.id, !!ready).then((e) => e && flash(e, 5000, 'err'));
  if (currentLevel.scenario.ziele?.length && !verbund) timer.start(levelKey(currentLevel.id, ready), load ? { ms: load.save.ms, counts: false } : {});
  log(`[kern] hello ok (${currentLevel.id}): ${res.manifest.devices.length} Geraete, Modus ${res.modus}, `
    + `${missing.length ? `${missing.length} FEHLENDE Nodes` : 'Manifest ok'}`);
}

function flash(text, ms = 2600, kind = '') {
  toast(settings.legacy(text), kind, ms);
}

function usePort() {
  room?.interact?.use();
}

/** E: Port (Kabel) hat Vorrang, sonst Notebook-Display -> Notebook-Fenster. */
function useTarget() {
  if (!room?.interact) return;
  // Plan v3: Hardware in der Hand -> einbauen (Rack-Platz, HE im Rack, Tisch-Platz)
  const inHand = room.cables.catalog.find((c) => c.item === room.cables.selected);
  if (room.place && HARDWARE.has(inHand?.typ)) {
    if (!room.place.ok) { flash(room.place.text, 2200, 'err'); return; }
    const intent = room.place.intent;
    room.kern.send(intent).then((res) => {
      if (res.type === 'reject') flash(res.reason, 3200, 'err');
      else flash(`eingebaut: ${niceDevice(res.node)}${res.ids?.length ? ` (${res.ids.map((x) => x.toUpperCase()).join(', ')})` : ''}`, 2400);
    });
    return;
  }
  const hand = room.cables.catalog.find((c) => c.item === room.cables.selected);
  if (hand?.typ === 'trunk') { useTrunk(hand); return; }
  if (room.interact.hover) { usePort(); return; }
  if (outletHover()) { openUi(() => ui.openDeskOutlet(outletHover())); return; }
  if (!seated && chairHover()) { sitDown(); return; }
  if (switchHover()) { setLights(!lightsOn); return; }
  if (wallHover()) { openUi(() => ui.openPlan()); return; }
  const node = room.interact.screenHover;
  const id = node && room.cables.manifest?.byNode.get(node)?.id;
  if (id?.startsWith('kvm')) {
    const net = room.cables.manifest.json.devices.filter((d) => /^(cs|sw|rt|fw)/.test(d.id));
    openUi(() => ui.openKvm(id, net));
  } else if (id) openUi(() => ui.openNotebook(id, id.toUpperCase()));
  else if (seated) standUp(); // im Sitzen: E ohne Ziel = aufstehen
}

/** R: SFP-Modul aus dem anvisierten Einschub zurueck ins Inventar */
function removeSfp() {
  const ev = room?.cables?.removeSfp(room.interact?.hover);
  if (ev) {
    room.kern.send(ev.intent).then((res) => flash(res.type === 'reject' ? res.reason : 'SFP-Modul entfernt'));
    return;
  }
  const td = outletHover(); // R auf der Tischdose: auf ein Patchpanel auflegen / loesen
  if (td) { openUi(() => ui.openDeskOutlet(td)); return; }
  // Plan v3: R auf ein eingebautes Geraet / Rack / Notebook = ausbauen (zurueck ins Inventar)
  const target = uninstallTarget();
  if (!target) return;
  room.kern.send({ action: 'uninstall', device: target.node }).then((res) => {
    flash(res.type === 'reject' ? res.reason : `ausgebaut: ${niceDevice(target.node)} – zurück im Inventar, Konfiguration bleibt`, 2600,
      res.type === 'reject' ? 'err' : '');
  });
}

/** Link nach unten: Patchpanel-ID vor dem Fadenkreuz (Port oder Frontplatte) */
function trunkTarget() {
  const name = room.interact.hover?.info.device ?? room.interact.lastHit?.name;
  const e = room.interact.lastHit && room.interact.lastHit.distance <= 2.2 ? room.placement.entryOf(name) : null;
  if (!e || e.vorlage !== 'kit_patchpanel') return null;
  return room.cables.manifest?.byNode.get(e.node)?.id ?? null;
}
function useTrunk(hand) {
  const pp = trunkTarget();
  if (!pp) return;
  const busy = (room.kernState?.trunks ?? []).some((t) => t.a === pp || t.b === pp);
  if (!room.trunkFrom && busy) {
    room.kern.send({ action: 'untrunk', device: pp }).then((r) => flash(r.type === 'reject' ? r.reason : `Trunk an ${pp.toUpperCase()} gelöst`, 2600, r.type === 'reject' ? 'err' : ''));
    return;
  }
  if (!room.trunkFrom) { room.trunkFrom = pp; flash(`Trunk beginnt an ${pp.toUpperCase()} – jetzt das Patchpanel im anderen Rack`, 2400); return; }
  const a = room.trunkFrom;
  room.trunkFrom = null;
  room.kern.send({ action: 'trunk', a, b: pp, item: hand.item }).then((r) => flash(r.type === 'reject' ? r.reason
    : `Trunk ${a.toUpperCase()} ↔ ${pp.toUpperCase()} verlegt – Port k ist mit Port k verbunden`, 3000, r.type === 'reject' ? 'err' : ''));
}

/** Eingebautes Objekt vor dem Fadenkreuz (<= 2.2 m), sonst null */
function uninstallTarget() {
  const h = room?.interact?.lastHit;
  if (!h || h.distance > 2.2) return null;
  const e = room.placement.entryOf(h.name);
  return e?.fixed ? null : e;
}

/** Tischdose vor dem Fadenkreuz (Gehaeuse oder Port) -> Kern-ID, sonst null */
function outletHover() {
  const h = room?.interact?.lastHit;
  if (!h || h.distance > 1.6 || !/^t1_outlet_1/.test(h.name ?? '')) return null;
  return room.cables.manifest?.byNode.get('t1_outlet_1')?.id ?? null;
}
/** "→ PP1 Port 11" fuer einen Port der Tischdose oder eines Patchpanels mit fester Leitung, sonst '' */
function fixedLineText(ref) {
  const far = ref && room.kern?._trunkFar?.(ref);
  if (!far) return '';
  const [d, p] = far.split('/');
  return ` → ${d.startsWith('td') ? 'Tischdose' : d.toUpperCase()} Port ${Number(p)}`;
}

// ---------- Licht (Plan v4): Schalter an der Wand beim Eingang ----------
let lightsOn = true;
function switchHover() {
  const h = room?.interact?.lastHit;
  return !!(h && h.distance <= 1.8 && /^light_switch/.test(h.name ?? ''));
}
/** Licht aus: LED-Baender dunkel, gebackenes Licht auf das Tageslicht durch die Glasfront reduziert. */
function setLights(on) {
  lightsOn = on;
  const k = on ? 1 : 0.22;
  for (const m of room.static.merged.map((x) => x.material)) {
    m.userData.lmBase ??= m.lightMapIntensity;
    if (m.lightMap) m.lightMapIntensity = m.userData.lmBase * k;
    if (/led_diffuser/.test(m.name)) {
      m.userData.emBase ??= m.emissiveIntensity;
      m.emissiveIntensity = on ? m.userData.emBase : 0.02;
    }
  }
  hemi.intensity = on ? 0.6 : 0.2;
  scene.environmentIntensity = on ? 0.35 : 0.12;
  setOwnEnv(KIT_ENV * scene.environmentIntensity); // Racks/Geraete dimmen mit
  flash(on ? 'Licht an' : 'Licht aus', 1400);
}

// ---------- Stuhl: hinsetzen / aufstehen ----------
let seated = false;
function chairHover() {
  const h = room?.interact?.lastHit;
  return !!(room?.chair && h && h.distance <= 1.8 && /^chair_1/.test(h.name ?? ''));
}
function sitDown() {
  const p = room.chair.pos;
  seated = true;
  crouched = false;
  player.position.set(p.x, 0, p.z);
  const t = room.chair.facing ?? new THREE.Vector3(p.x, 0, p.z - 1);
  yaw = Math.atan2(-(t.x - p.x), -(t.z - p.z));
  pitch = -0.35;
  flash(`Du sitzt am Tisch – E/Klick oder ${settings.key('forward')}/${settings.key('back')}: aufstehen`, 2600);
}
function standUp() {
  if (!seated) return;
  seated = false;
  // einen halben Schritt hinter den Stuhl, damit man nicht im Tisch steht
  player.position.addScaledVector(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), 0.55);
}
function eyeHeight() {
  return seated ? HEAD_H_SIT : crouched ? HEAD_H_CROUCH : HEAD_H;
}

function cancelCable() {
  if (room?.trunkFrom) { room.trunkFrom = null; flash('Trunk abgebrochen'); return; }
  if (!room?.cables?.pending || room.cables.awaiting) return; // laufende Anfrage nicht abbrechen
  room.cables.cancel();
  room.interact.mark(null);
  flash('Kabel abgebrochen');
}

const KIND = { switch: 'Switch', coreswitch: 'Core-Switch', patchpanel: 'Patchpanel', router: 'Router', firewall: 'Firewall',
  notebook: 'Notebook', kvm: 'KVM', server: 'Server', blank: 'Blindplatte', pdu: 'Stromleiste' };
/** "r1_switch_U41" -> "Switch U41", "t1_notebook_1" -> "Notebook NB1" */
function niceDevice(node) {
  const id = room?.cables?.manifest?.byNode.get(node)?.id;
  if (node === 'bench_1') return 'Pult-Gestell';
  if (node === 't1_outlet_1') return 'Tischdose';
  if (node === 't1_strip_1') return 'Steckdosenleiste am Pult';
  const rk = /^rack_(\d+)$/.exec(node ?? '');
  if (rk) return `Rack ${rk[1]}`;
  const pdu = /_pdu_0u_([LR])$/.exec(node);
  if (pdu) return `PDU ${pdu[1] === 'L' ? 'links' : 'rechts'}`;
  const m = /_([a-z]+)_(U\d+|\d+)$/.exec(node);
  if (!m) return node;
  const kind = KIND[m[1]] ?? m[1];
  if (m[1] === 'notebook') return id ? `${kind} ${id.toUpperCase()}` : kind;
  const rack = /^r(\d+)_/.exec(node)?.[1];
  // Plan v3: Kern-ID (SW1, PP1 ...) + Einbauort, damit Ziele ("SW1 Port 07") auffindbar sind
  return `${kind}${id ? ` ${id.toUpperCase()}` : ''} (${rack ? `Rack ${rack} · ` : node.startsWith('b1_') ? 'Pult · ' : ''}${m[2].replace('U', 'HE ')})`;
}

/** Text -> Prompt-Pille; "E:", "Q:", "R:" und "{left}" werden zu Tastenkappen (aktuelle Belegung). */
const LETTER = { E: 'use', Q: 'cancel', R: 'remove', B: 'shop' };
function setPrompt(text) {
  if (text === lastPrompt) return;
  lastPrompt = text;
  promptEl.innerHTML = text ? esc(settings.legacy(text)).replace(/\b([EQRB]): ?/g, (m, l) => `${cap(LETTER[l])} `).replace(/\{(\w+)\}/g, (m, id) => (id in settings.keys ? cap(id) : m)).replace(/^([^·—]+ · [^—]+) — /, '<span class="dev">$1</span>') : '';
}

function updatePrompt() {
  const it = room?.interact;
  if (!room?.placement) return;
  // Plan v3: Hardware in der Hand -> Einbau-Ziel (Geister-Vorschau) statt Ports
  const hand = room.cables.catalog.find((c) => c.item === room.cables.selected);
  room.place = null;
  if (hand && HARDWARE.has(hand.typ) && !seated) {
    room.place = room.placement.target(hand, camera, headPos.set(player?.position.x ?? 0, eyeHeight(), player?.position.z ?? 0));
    it?.update();
    crosshairEl.classList.toggle('on', !!room.place?.ok);
    setPrompt(room.place?.text ?? `${hand.kurz ?? hand.name} in der Hand — Platz/Rack anvisieren · 1: Hand leeren`);
    return;
  }
  room.placement.hide();
  if (hand?.typ === 'trunk' && !seated) {
    it?.update();
    const pp = trunkTarget();
    const from = room.trunkFrom;
    crosshairEl.classList.toggle('on', !!pp);
    setPrompt(!pp ? (from ? `Trunk von ${from.toUpperCase()} → Patchpanel im anderen Rack anvisieren · Q: abbrechen`
      : 'Trunk in der Hand — Patchpanel anvisieren (Rack A)')
      : from ? `Trunk ${from.toUpperCase()} → ${pp.toUpperCase()} — E: über die Gitterrinne verlegen · Q: abbrechen`
        : (room.kernState?.trunks ?? []).some((t) => t.a === pp || t.b === pp) ? `${pp.toUpperCase()} hat einen Trunk — E: Trunk lösen`
          : `${pp.toUpperCase()} — E: Trunk hier beginnen`);
    return;
  }
  const h = it?.update();
  room?.cables?.update(h);
  const pend = room?.cables?.pending;
  const a = pend ? room.cables.port(pend.index) : null;
  const head = a ? `Kabel von ${niceDevice(a.info.device)} ${a.info.id} → ` : '';
  crosshairEl.classList.toggle('on', !!(h || it?.screenHover));
  if (!h) {
    const node = it?.screenHover;
    const id = node && room.cables.manifest?.byNode.get(node)?.id;
    setPrompt(a ? `${head}Ziel-Port anvisieren · Q: abbrechen`
      : id?.startsWith('kvm') ? `Rack-Konsole ${id.toUpperCase()} — E: öffnen` : id ? `${niceDevice(node)} — E: Notebook benutzen · R: wegräumen`
      : seated ? 'Am Tisch — Bildschirm anvisieren: {use} benutzen · {left}{right} rollen · {forward}{back} oder E: aufstehen'
      : switchHover() ? `Lichtschalter — E: Licht ${lightsOn ? 'aus' : 'an'}`
      : wallHover() ? 'Wandbildschirm — E: Netzplan öffnen'
      : outletHover() ? 'Tischdose — E: auf ein Patchpanel auflegen'
      : chairHover() ? 'Bürostuhl — E: hinsetzen'
      : uninstallTarget() ? `${niceDevice(uninstallTarget().node)} — R: ausbauen` : '');
    return;
  }
  const { device, id, kind } = h.info;
  const what = room.cables.preview_text(h);
  const portName = kind === 'power' ? (id === 'psu' ? 'Netzteil (C14)' : `Steckdose ${Number(id)}`)
    : /^\d+$/.test(id) ? `Port ${Number(id)} ${kind}` : `${id} ${kind}`;
  const line = fixedLineText(room.cables.manifest?.portRef(h.name));
  const extra = device === 't1_outlet_1' && !a && !line ? ' · R: auf ein Patchpanel auflegen' : '';
  setPrompt(`${head}${niceDevice(device)} · ${portName}${line} — ${what.text}${extra}`);
}

function triggerAction(state) {
  if (!anim || crouched) return;
  anim.trigger(state, 'idle');
}

async function loadCharacter() {
  if (!CHARACTER) {
    // Ego ohne Figur: unsichtbarer Koerper (Position/Kollision), Blick direkt auf das Rack
    player = new THREE.Object3D();
    player.name = 'player';
    scene.add(player);
    if (room) {
      player.position.copy(room.spawn);
      yaw = room.spawnYaw;
      pitch = -0.05;
      snapCamera = true;
    }
    document.getElementById('loading').remove();
    return;
  }
  // Figur liegt nur lokal (Mixamo: keine Weitergabe als Datei), der Build geht auch ohne sie
  const [load] = Object.values(import.meta.glob('../../assets/out/character.glb', { query: '?url', import: 'default' }));
  if (!load) throw new Error('assets/out/character.glb fehlt');
  const gltf = await loader.loadAsync(await load());
  player = gltf.scene;
  player.traverse((o) => {
    if (o.isMesh) o.frustumCulled = false; // Skinned Mesh: Bounds folgen der Animation nicht
  });
  scene.add(player);
  if (room) {
    player.position.copy(room.spawn);
    player.rotation.y = Math.PI; // Blick in den Raum (-Z)
    snapCamera = true;
  }
  anim = new CharacterAnimator(player, gltf.animations);
  anim.play('idle');

  const size = new THREE.Box3().setFromObject(player).getSize(new THREE.Vector3());
  log(
    `[character] ${gltf.animations.length} Clips, Hoehe ${size.y.toFixed(2)} m:`,
    gltf.animations.map((a) => a.name).join(', '),
  );
  document.getElementById('loading').remove();
}

// ---------- Update ----------
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const move = new THREE.Vector3();
const camPos = new THREE.Vector3(0, THIRD_H, THIRD_DIST);
const camTarget = new THREE.Vector3();
const lookAt = new THREE.Vector3();
const lookDir = new THREE.Vector3();
const pivot = new THREE.Vector3();
const back = new THREE.Vector3();
const ray = new THREE.Raycaster();

function updatePlayer(dt) {
  if (!player) return;

  // WASD relativ zur Blickrichtung (Yaw)
  forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  right.set(-forward.z, 0, forward.x);
  move.set(0, 0, 0);
  if (down('forward')) move.add(forward);
  if (down('back')) move.sub(forward);
  if (down('right')) move.add(right);
  if (down('left')) move.sub(right);
  const tm = touch.move;
  if (tm.x || tm.y) move.addScaledVector(forward, tm.y).addScaledVector(right, tm.x);
  // Plan v4: sitzend mit A/D am Pult entlangrollen, W/S = aufstehen
  if (seated && (down('forward') || down('back') || Math.abs(tm.y) > 0.7)) standUp();
  if (seated) {
    const side = (down('right') || tm.x > 0.3 ? 1 : 0) - (down('left') || tm.x < -0.3 ? 1 : 0);
    const desk = room?.supports?.[0];
    if (side && desk) {
      // entlang der langen Tischkante, Blick bleibt zum Tisch
      const along = desk.max.x - desk.min.x >= desk.max.z - desk.min.z ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
      const r = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)); // rechts vom Blick (forward x up)
      const dir = Math.sign(along.dot(r)) || 1;
      player.position.addScaledVector(along, side * dir * 0.9 * dt);
      player.position.x = THREE.MathUtils.clamp(player.position.x, desk.min.x + 0.25, desk.max.x - 0.25);
      player.position.z = along.z ? THREE.MathUtils.clamp(player.position.z, desk.min.z + 0.25, desk.max.z - 0.25) : player.position.z;
    }
    move.set(0, 0, 0);
  }

  const busy = anim?.busy ?? false;
  const moving = move.lengthSq() > 0 && !busy;
  const running = moving && !crouched && (down('run') || Math.hypot(tm.x, tm.y) > 0.95);

  if (moving) {
    move.normalize();
    const speed = crouched ? SPEED.crouch : running ? SPEED.run : SPEED.walk;
    player.position.addScaledVector(move, speed * dt);
    if (room) resolveCollisions(player.position, PLAYER_R, room.colliders);
    // Figur (Mixamo-Forward = +Z) in Laufrichtung drehen, kuerzester Winkel
    const targetRot = Math.atan2(move.x, move.z);
    let d = targetRot - player.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    player.rotation.y += d * (1 - Math.exp(-TURN_LERP * dt));
  }

  if (anim && !busy) {
    if (crouched) anim.play(moving ? 'crouch_walk' : 'crouch_idle');
    else anim.play(running ? 'run' : moving ? 'walk' : 'idle');
  }
  anim?.update(dt);
  blob.position.x = player.position.x;
  blob.position.z = player.position.z;
  blob.visible = !firstPerson && CHARACTER;
  stateEl.textContent = anim ? `${firstPerson ? 'Ego' : 'Third'} · ${anim.current}`
    : `Ego${seated ? ' · sitzt' : crouched ? ' · geduckt' : ''}`;
}

function updateCamera(dt) {
  const fov = zoomHeld ? FOV_ZOOM : FOV;
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov += (fov - camera.fov) * (1 - Math.exp(-12 * dt));
    camera.updateProjectionMatrix();
  }
  const base = player ? player.position : camTarget.set(0, 0, 0);
  lookDir.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));

  if (firstPerson) {
    camTarget.set(base.x, eyeHeight(), base.z);
  } else {
    // hinter und ueber der Figur, Pitch kippt die Kamera um die Figur
    // Kamera-Kollision: vom Kopf nach hinten casten, vor Waenden/Rack verkuerzen
    let dist = THIRD_DIST;
    if (room) {
      pivot.set(base.x, THIRD_H, base.z);
      ray.set(pivot, back.copy(lookDir).negate());
      ray.far = THIRD_DIST + CAM_MARGIN;
      const hit = ray.intersectObjects(room.cameraBlockers, false)[0];
      if (hit) dist = Math.max(0.3, hit.distance - CAM_MARGIN);
    }
    camTarget.set(base.x, THIRD_H, base.z).addScaledVector(lookDir, -dist);
    camTarget.y = THREE.MathUtils.clamp(camTarget.y, 0.3, 2.8);
  }
  if (snapCamera) {
    camPos.copy(camTarget);
    snapCamera = false;
  } else camPos.lerp(camTarget, 1 - Math.exp(-CAM_LERP * dt));
  camera.position.copy(camPos);

  if (firstPerson) lookAt.copy(camPos).add(lookDir);
  else lookAt.set(base.x, THIRD_H - 0.25, base.z);
  camera.lookAt(lookAt);
}

// ---------- FPS-Mittel ueber 10 s (Echtzeit, NICHT das auf 0.1 s geklemmte dt) ----------
let fpsFrames = 0;
let fpsStart = performance.now();
let renderMs = 0;
const fpsEl = document.getElementById('fps');
const live = { fps: 0, ms: 0, frames: 0, t0: performance.now() }; // Anzeige: Mittel ueber eine halbe Sekunde
function trackFps() {
  fpsFrames++;
  live.frames++;
  const lt = performance.now() - live.t0;
  if (lt >= 500) {
    Object.assign(live, { fps: (live.frames * 1000) / lt, ms: lt / live.frames, frames: 0, t0: performance.now() });
    if (settings.fps) fpsEl.textContent = `${Math.round(live.fps)} FPS`;
  }
  const t = performance.now() - fpsStart;
  if (t >= 10000) {
    log(`[fps] avg ${((fpsFrames * 1000) / t).toFixed(1)} (10 s, pixelRatio ${renderer.getPixelRatio()},`,
      `draw calls ${renderer.info.render.calls}, render() ${(renderMs / fpsFrames).toFixed(2)} ms CPU)`);
    fpsFrames = 0;
    renderMs = 0;
    fpsStart = performance.now();
  }
}

// ---------- Loop ----------
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  updatePlayer(dt);
  updateCamera(dt);
  updatePrompt();
  moveMapArrow();
  timer.tick();
  const t0 = performance.now();
  renderer.render(scene, camera);
  renderMs += performance.now() - t0;
  trackFps();
});

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(pixelRatio(settings.quality, window.devicePixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  drawMap();
});

// Raum zuerst (Spawn-Punkt), Figur danach; Raum-Fehler -> Platzhalter-Boden bleibt.
loadRoom()
  .catch((err) => console.error('[room] Laden fehlgeschlagen, Platzhalter-Boden aktiv', err))
  .then(loadCharacter)
  .catch((err) => {
    console.error('[character] Laden fehlgeschlagen', err);
    document.getElementById('loading').textContent = 'Figur konnte nicht geladen werden (siehe Konsole).';
  });

// Debug-Handle nur im Dev-Server (Playwright-Checks, Konsole)
if (import.meta.env.DEV) {
  window.__dc = {
    THREE, scene, camera, ray, renderer,
    get room() { return room; },
    get player() { return player; },
    get anim() { return anim; },
    usePort,
    useTarget,
    get ui() { return ui; },
    startSession: (...a) => startSession(...a),
    cancelCable,
    get kern() { return room?.kern; },
    leyonet,
    get yaw() { return yaw; },
    setView(y, p = pitch) { yaw = y; pitch = p; },
    openMenu: () => openMenu(),
    setLights: (on) => setLights(on),
    timer,
    classroom,
    settings,
    unlock,
    live,
    makeSave: () => makeSave(),
    loadSave: (save, run) => loadSave(save, run),
  };
}
