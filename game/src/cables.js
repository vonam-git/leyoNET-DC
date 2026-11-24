import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { describePort } from './interact.js';

// Kabelziehen (KONZEPT Kap. 4): E auf Port A -> Vorschau folgt der Hand -> E auf Port B.
// "Gequantelt": Laenge rastet auf Standard-Patchkabel ein, der Durchhang wird so bestimmt,
// dass die Kurve genau diese Laenge hat (Realismus-Regel 5: CatmullRom + Durchhang, nie straff).
// (Ein 1-cm-Raster des Durchhang-Punkts machte die Laenge sprunghaft - bei 0.25 m bis 8 % daneben,
// deshalb quantisiert nur die Laenge.) Alle verlegten Kabel = EINE Mesh (1 Draw Call).

export const LENGTHS = [0.25, 0.5, 1, 1.5, 2, 3, 5]; // m, Patchkabel
const RADIUS = 0.0029; // Cat6-Patchkabel ~5.8 mm
const PLUG = { w: 0.0115, h: 0.0082, d: 0.022 }; // RJ45-Stecker
const STRAIGHT = 0.06; // m gerader Auslauf vor dem Port (Stecker + Knickschutz)
const CLASS = { rj45: 'copper', keystone: 'copper', sfp: 'sfp', console: 'console', power: 'power' };
const CLASS_LABEL = { copper: 'Kupfer (RJ45)', sfp: 'SFP+ (Glasfaser)', console: 'Konsole', power: 'Strom (C13/C14)' };
const COLORS = [0x1f5fd1, 0xe0b21a, 0x8a8f96, 0xd23a2a, 0x2e9b46];
// Kollision (Kabel durch Geraete): Kurve alle ~1 cm abtasten gegen Geraete-Huellen (AABB, um
// Kabelradius + Spiel erweitert) und den Boden; der gerade Auslauf am Port ist ausgenommen.
// Ausweichen: Woelbung nach vorn (vor die Rackfront) schrittweise erhoehen, Durchhang je
// Schritt neu loesen (Laenge bleibt Standard); reicht das nicht -> naechste Standardlaenge.
const CLEARANCE = RADIUS + 0.002;
const END_SKIP = 0.05; // m Bogenlaenge an jedem Ende ohne Pruefung (Stecker sitzt am Geraet)
const OUT_STEPS = Array.from({ length: 16 }, (_, k) => k * 0.02); // 0 .. 0.30 m zusaetzlich
const FLOOR_Y = 0.0;
// Kabelbinder (Regel 5): alle ~30 cm, nicht naeher als 8 cm an einem Stecker
const TIE_PITCH = 0.3;
const TIE_END = 0.08;

function curveFor(pA, nA, pB, nB, sag, extraOut = 0) {
  const up = new THREE.Vector3(0, 1, 0);
  const a1 = pA.clone().addScaledVector(nA, STRAIGHT * 0.5);
  const a2 = pA.clone().addScaledVector(nA, STRAIGHT);
  const b1 = pB.clone().addScaledVector(nB, STRAIGHT * 0.5);
  const b2 = pB.clone().addScaledVector(nB, STRAIGHT);
  const out = nA.clone().add(nB);
  if (out.lengthSq() < 1e-6) out.copy(nA);
  out.normalize();
  const m = a2.clone().add(b2).multiplyScalar(0.5).addScaledVector(up, -sag)
    .addScaledVector(out, sag * 0.35 + extraOut);
  return new THREE.CatmullRomCurve3([pA, a1, a2, m, b2, b1, pB], false, 'centripetal');
}

/** Durchhang so loesen, dass die Kurve `length` lang ist. null = zu kurz fuer diese Form. */
function solveSag(pA, nA, pB, nB, length, extraOut) {
  if (curveFor(pA, nA, pB, nB, 0, extraOut).getLength() > length) return null;
  let lo = 0;
  let hi = length / 2;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (curveFor(pA, nA, pB, nB, mid, extraOut).getLength() < length) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Erster Kollisionspunkt der Kurve mit Huellen/Boden oder null. */
export function cableCollision(curve, hulls) {
  const len = curve.getLength();
  const n = Math.max(8, Math.ceil(len / 0.01));
  const pts = curve.getSpacedPoints(n);
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * len;
    if (s < END_SKIP || s > len - END_SKIP) continue;
    const p = pts[i];
    // Boden ist KEIN Hindernis: ueberschuessiges Kabel liegt auf (siehe CableManager._supported)
    for (const h of hulls) {
      const b = h.box;
      if (p.x > b.min.x - CLEARANCE && p.x < b.max.x + CLEARANCE && p.y > b.min.y - CLEARANCE
        && p.y < b.max.y + CLEARANCE && p.z > b.min.z - CLEARANCE && p.z < b.max.z + CLEARANCE) {
        return { point: p, hull: h.name };
      }
    }
  }
  return null;
}

/**
 * Kabelweg A -> B mit Standardlaenge, Durchhang und ohne Geraete-Durchdringung.
 * hulls: [{ name, box: THREE.Box3 }]. Rueckgabe { curve, length, sag, out, minLen } oder
 * { blocked: true, reason } (zu weit / kein freier Weg).
 */
export function routeCable(pA, nA, pB, nB, hulls = [], lengths = LENGTHS) {
  const minLen = curveFor(pA, nA, pB, nB, 0).getLength();
  let lastHit = null;
  for (const length of lengths) {
    if (length < minLen * 1.02) continue;
    for (const extra of OUT_STEPS) {
      const sag = solveSag(pA, nA, pB, nB, length, extra);
      if (sag === null) break; // noch mehr Woelbung macht es nur laenger
      const curve = curveFor(pA, nA, pB, nB, sag, extra);
      const hit = cableCollision(curve, hulls);
      if (!hit) return { curve, length, sag, out: extra, minLen };
      lastHit = hit;
    }
  }
  if (!lengths.length) return { blocked: true, reason: 'kein Kabel im Inventar' };
  if (minLen * 1.02 > lengths.at(-1)) {
    return { blocked: true, reason: lengths === LENGTHS ? 'zu weit (max. 5 m)' : `kein passendes Kabel im Inventar (braucht > ${lengths.at(-1)} m)` };
  }
  return { blocked: true, reason: `kein freier Weg (${lastHit?.hull ?? '?'} im Weg)` };
}

/** Kabelbinder-Positionen (Punkt + Tangente) alle TIE_PITCH entlang der Kurve. */
export function tiePositions(curve) {
  const len = curve.getLength();
  const out = [];
  for (let s = TIE_PITCH; s < len - TIE_END + 1e-6; s += TIE_PITCH) {
    if (s < TIE_END) continue;
    const u = s / len;
    out.push({ point: curve.getPointAt(u), tangent: curve.getTangentAt(u) });
  }
  return out;
}

/** Geraete-Huellen aus dem Raum-GLB (vor dem Buendeln, Original-Meshes). */
export function deviceHulls(root) {
  const byDev = new Map();
  // Geraet = HOECHSTER Vorfahre mit Geraete-Praefix (flach: Gruppe r1_switch_U41 -> Primitive
  // r1_switch_U41_1..; roh: rack_1 > r1_switch_U41). rack_1 selbst (Gehaeuse) ist keine Huelle.
  const devRe = /^([rb]\d+_|rack_\d+_blank_)/; // r3_ = Rack 3, b1_ = Gestell auf dem Pult
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || o.userData.leyonet_overlay) return;
    let dev = null;
    for (let q = o; q; q = q.parent) if (devRe.test(q.name)) dev = q.name;
    if (!dev) return;
    const box = new THREE.Box3().setFromBufferAttribute(o.geometry.attributes.position).applyMatrix4(o.matrixWorld);
    if (!byDev.has(dev)) byDev.set(dev, new THREE.Box3());
    byDev.get(dev).union(box);
  });
  return [...byDev].map(([name, box]) => ({ name, box }));
}

export class CableManager {
  constructor({ scene, batch, getHand, hulls = [], supports = [] }) {
    this.supports = supports; // Box3 der Tischplatten
    this.rev = -1; // zuletzt angewendeter Kern-Zustand
    this.manifest = null; // RoomManifest (E1), gesetzt nach hello
    this.modus = 'sandbox'; // E2
    this.catalog = [];
    this.inventory = {};
    this.awaiting = null; // K11: gesendeter link-Intent, Vorschau bleibt bis ack/reject
    this.sfp = {}; // eingesetzte SFP-Module (Kern-Zustand)
    this.sfpMesh = null;
    this.batch = batch;
    this.getHand = getHand;
    this.hulls = hulls;
    this._routes = new Map(); // "A|B" -> routeCable-Ergebnis (Kollisionssuche nur einmal pro Paar)
    this.cables = []; // { a, b, length, color }
    this.byPort = new Map(); // Port-Name -> Kabel
    this.pending = null; // { name, index, info }
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0, vertexColors: true });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.name = 'cables';
    this.mesh.frustumCulled = false;
    this.preview = new THREE.Mesh(new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({ color: COLORS[0], roughness: 0.45, transparent: true, opacity: 0.75 }));
    this.preview.frustumCulled = false;
    this.preview.visible = false;
    scene.add(this.mesh, this.preview);
    this._m = new THREE.Matrix4();
    // LEDs + Kabel kommen ausschliesslich aus dem Kern-Zustand (applyState), nicht aus use()
  }

  port(index) {
    const ports = this.batch.ports;
    ports.getMatrixAt(index, this._m);
    const pos = new THREE.Vector3().setFromMatrixPosition(this._m);
    const normal = new THREE.Vector3().setFromMatrixColumn(this._m, 2).normalize();
    const name = ports.userData.names[index];
    const info = describePort(name, ports.userData.extras[index]);
    return { index, name, pos, normal, info, cls: CLASS[ports.userData.extras[index].leyonet_port_kind] ?? 'copper',
      basis: this._m.clone() };
  }

  /** Was passiert bei E auf `hover`? -> { action, text } (fuer den Prompt) */
  /** SFP-Modul im Einschub (Kern-Zustand) oder null */
  sfpAt(portName) {
    return this.manifest ? this.sfp[this.manifest.portRef(portName)] ?? null : null;
  }

  /** erstes SFP-Modul mit Bestand (Katalog-Reihenfolge) */
  _sfpItem() {
    return this.catalog.find((c) => c.typ === 'sfp' && (this.modus !== 'katalog' || (this.inventory[c.item] ?? 0) > 0)) ?? null;
  }

  preview_text(hover) {
    if (!hover) return null;
    const p = this.port(hover.index);
    if (this.byPort.has(p.name)) return { action: 'unplug', text: 'E: Kabel abziehen' };
    if (p.cls === 'sfp' && !this.pending) {
      const mod = this.sfpAt(p.name);
      if (!mod) {
        const it = this._sfpItem();
        return it ? { action: 'sfp_insert', item: it.item, text: `E: SFP-Modul einsetzen (${it.modul}${this.modus === 'katalog' ? `, noch ${this.inventory[it.item]}` : ''})` }
          : { action: 'invalid', text: 'leerer SFP-Einschub - SFP-Modul im Shop kaufen (B)' };
      }
      return { action: 'start', text: `SFP ${mod} — E: Glasfaser anstecken · R: Modul entfernen` };
    }
    if (!this.pending) return { action: 'start', text: 'E: Kabel anstecken' };
    if (this.pending.name === p.name) return { action: 'cancel', text: 'E: abbrechen' };
    const a = this.port(this.pending.index);
    if (a.cls !== p.cls) return { action: 'invalid', text: `passt nicht: ${CLASS_LABEL[a.cls]} -> ${CLASS_LABEL[p.cls]}` };
    const r = this.route(a, p);
    if (r.blocked) return { action: 'invalid', text: r.reason };
    if (this.modus === 'katalog') {
      const it = this.itemFor(r.length, a.cls);
      return { action: 'connect', text: `E: verbinden (${r.length} m, ${it.farbe_name ?? it.item}, noch ${this.inventory[it.item]})` };
    }
    return { action: 'connect', text: `E: verbinden (${r.length} m Kabel)` };
  }

  /** E-Taste. Rueckgabe: Ereignis oder null. */
  use(hover) {
    const what = this.preview_text(hover);
    if (!what) return null;
    const p = this.port(hover.index);
    if (this.awaiting) return null; // K11: auf Antwort des Kerns warten
    if (what.action === 'sfp_insert') {
      return { action: 'intent', intent: { action: 'sfp_insert', port: this.manifest.portRef(p.name), item: what.item } };
    }
    if (what.action === 'unplug') {
      return { action: 'intent', intent: { action: 'unlink', port: this.manifest.portRef(p.name) } };
    }
    if (what.action === 'start') {
      this.pending = { name: p.name, index: p.index };
      this.preview.material.color.setHex(COLORS[this.cables.length % COLORS.length]);
      this.preview.visible = true;
      return { action: 'start', port: p.name };
    }
    if (what.action === 'cancel') {
      this.cancel();
      return { action: 'cancel' };
    }
    if (what.action === 'invalid') return { action: 'invalid', text: what.text };
    const a = this.port(this.pending.index);
    const r = this.route(a, p);
    let cable;
    if (this.modus === 'katalog') {
      const it = this.itemFor(r.length, a.cls); // E2: Artikel aus dem Inventar, Farbe/Laenge daraus
      cable = { item: it.item, length: it.laenge, color: it.farbe };
      this.preview.material.color.set(it.farbe);
    } else {
      cable = { length: r.length, color: `#${COLORS[this.cables.length % COLORS.length].toString(16).padStart(6, '0')}` };
    }
    const intent = { action: 'link', from: this.manifest.portRef(a.name), to: this.manifest.portRef(p.name), cable };
    this.awaiting = { intent, a: a.index, b: p.index }; // K11: Vorschau bleibt bis ack/reject
    return { action: 'intent', intent };
  }

  /** K11: Antwort des Kerns auf einen gesendeten Intent -> Vorschau weg. */
  resolve(_res) {
    if (!this.awaiting) return;
    this.awaiting = null;
    this.cancel();
  }

  /** Kern-Zustand rendern (docs/SCENARIO_API.md): Kabel aus links, LEDs aus leds. */
  /** R auf einem SFP-Einschub: Modul zurueck ins Inventar (Kern lehnt ab, solange ein Kabel steckt). */
  removeSfp(hover) {
    if (!hover || this.awaiting) return null;
    const p = this.port(hover.index);
    if (p.cls !== 'sfp' || !this.sfpAt(p.name)) return null;
    return { action: 'intent', intent: { action: 'sfp_remove', port: this.manifest.portRef(p.name) } };
  }

  /** Eingesetzte SFP-Module als kleine Einschuebe (eine InstancedMesh, Farbe = Modul-Lasche). */
  _rebuildSfp() {
    const names = this.batch.ports.userData.names;
    const list = Object.entries(this.sfp).map(([ref, mod]) => ({ i: names.indexOf(this.manifest.portNode(ref)), mod }))
      .filter((x) => x.i >= 0);
    if (this.sfpMesh) {
      this.sfpMesh.removeFromParent();
      this.sfpMesh.dispose();
      this.sfpMesh = null;
    }
    if (!list.length) return;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.6 }), list.length);
    const m = new THREE.Matrix4();
    list.forEach(({ i, mod }, k) => {
      const p = this.port(i);
      const x = new THREE.Vector3().setFromMatrixColumn(p.basis, 0);
      const y = new THREE.Vector3().setFromMatrixColumn(p.basis, 1);
      // Modul fuellt die Oeffnung und ragt 6 mm heraus (Laschen-Farbe wie im Katalog)
      m.makeBasis(x.multiplyScalar(0.95), y.multiplyScalar(0.95), p.normal.clone().multiplyScalar(0.012))
        .setPosition(p.pos.clone().addScaledVector(p.normal, 0.0));
      mesh.setMatrixAt(k, m);
      const item = this.catalog.find((c) => c.typ === 'sfp' && c.modul === mod);
      mesh.setColorAt(k, new THREE.Color(item?.farbe ?? '#9aa3ad'));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.name = 'sfp_modules';
    this.preview.parent.add(mesh);
    this.sfpMesh = mesh;
  }

  applyState(st) {
    if (st.rev <= this.rev) return false;
    this.rev = st.rev;
    this.sfp = { ...(st.sfp ?? {}) };
    const names = this.batch.ports.userData.names;
    this.cables = [];
    this.byPort.clear();
    this.inventory = { ...(st.inventory ?? {}) };
    for (const l of st.links) {
      const ia = names.indexOf(this.manifest.portNode(l.a));
      const ib = names.indexOf(this.manifest.portNode(l.b));
      if (ia < 0 || ib < 0) continue;
      const a = this.port(ia);
      const b = this.port(ib);
      let r = this.route(a, b);
      if (r.blocked) r = routeCable(a.pos, a.normal, b.pos, b.normal); // Kern hat entschieden
      if (r.blocked) continue;
      const cable = { id: l.id, a: a.name, b: b.name, length: l.length ?? r.length,
        color: l.color ? parseInt(l.color.slice(1), 16) : COLORS[0], curve: this._supported(r.curve), out: +(r.out ?? 0).toFixed(2),
        sag: +r.sag.toFixed(3) };
      this.cables.push(cable);
      this.byPort.set(a.name, cable);
      this.byPort.set(b.name, cable);
    }
    for (const [ref, state] of Object.entries(st.leds ?? {})) this.batch.setLed(this.manifest.ledNode(ref), state);
    this._rebuildSfp();
    this._rebuild();
    return true;
  }

  cancel() {
    this.pending = null;
    this.preview.visible = false;
  }

  _plug(p) {
    const g = new THREE.BoxGeometry(PLUG.w, PLUG.h, PLUG.d);
    const basis = new THREE.Matrix4();
    const x = new THREE.Vector3().setFromMatrixColumn(p.basis, 0).normalize();
    const y = new THREE.Vector3().setFromMatrixColumn(p.basis, 1).normalize();
    basis.makeBasis(x, y, p.normal).setPosition(p.pos.clone().addScaledVector(p.normal, PLUG.d * 0.5 - 0.004));
    return g.applyMatrix4(basis);
  }

  _tube(curve) {
    return new THREE.TubeGeometry(curve, 64, RADIUS, 6, false);
  }

  _colored(g, hex) {
    const c = new THREE.Color(hex);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.toArray(arr, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  }

  /** Neues Level: alles zuruecksetzen (Kabel, Vorschau, Kern-rev). */
  reset() {
    this.rev = -1;
    this.sfp = {};
    if (this.manifest) this._rebuildSfp(); // Module des vorigen Levels entfernen
    this.cables = [];
    this.byPort.clear();
    this.awaiting = null;
    this._routes.clear();
    this.cancel();
    this._rebuild();
  }

  /** Plan v3: neue Geraete-Gruppe (Ein-/Ausbau) - Ports/LEDs/Huellen neu, Zustand wird neu angewendet. */
  rebind(batch, hulls) {
    this.batch = batch;
    this.hulls = hulls;
    this._routes.clear();
    this.rev = -1;
    if (this.pending && !batch.ports.userData.names.includes(this.pending.name)) this.cancel();
    else if (this.pending) this.pending.index = batch.ports.userData.names.indexOf(this.pending.name);
  }

  /** Sitzung nach hello (E1/E2): Manifest, Modus, Katalog. */
  setSession({ manifest, modus, catalog }) {
    this.manifest = manifest;
    this.modus = modus ?? 'sandbox';
    this.catalog = catalog ?? [];
  }

  /** E2: im Katalog-Modus nur Laengen mit Bestand und passender Kabelklasse (Patch/Konsole). */
  lengths(cls = 'copper') {
    if (this.modus !== 'katalog') return LENGTHS;
    const sel = this.selectedItem(cls);
    if (sel) return [sel.laenge]; // gewaehltes Kabel aus dem Inventar: genau diese Laenge
    const have = this.catalog.filter((c) => (c.klasse ?? 'copper') === cls && (this.inventory[c.item] ?? 0) > 0)
      .map((c) => c.laenge);
    return [...new Set(have)].sort((x, y) => x - y);
  }

  /** E2: Katalog-Artikel fuer Laenge + Klasse (erster mit Bestand). */
  /** Im Inventar gewaehlter Artikel (Hotbar), wenn er zur Kabelklasse passt und Bestand hat. */
  selectedItem(cls) {
    const c = this.selected && this.catalog.find((x) => x.item === this.selected);
    return c && (c.klasse ?? 'copper') === cls && (this.inventory[c.item] ?? 0) > 0 ? c : null;
  }

  itemFor(length, cls = 'copper') {
    const sel = this.selectedItem(cls);
    if (sel) return sel.laenge === length ? sel : null;
    return this.catalog.find((c) => c.laenge === length && (c.klasse ?? 'copper') === cls
      && (this.inventory[c.item] ?? 0) > 0) ?? null;
  }

  /** Kabel liegen auf Tischplatten und dem Boden auf statt hindurchzuhaengen (Punkte anheben). */
  _supported(curve) {
    const pts = curve.getSpacedPoints(96);
    let touched = false;
    for (const p of pts) {
      if (p.y < FLOOR_Y + RADIUS) {
        p.y = FLOOR_Y + RADIUS; // auf dem Boden
        touched = true;
      }
      for (const b of this.supports) {
        if (p.x > b.min.x && p.x < b.max.x && p.z > b.min.z && p.z < b.max.z && p.y < b.max.y + RADIUS) {
          p.y = b.max.y + RADIUS;
          touched = true;
        }
      }
    }
    return touched ? new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5) : curve;
  }

  route(a, p) {
    const lengths = this.lengths(a.cls);
    const key = `${a.name}|${p.name}|${lengths.join(',')}`;
    if (!this._routes.has(key)) this._routes.set(key, routeCable(a.pos, a.normal, p.pos, p.normal, this.hulls, lengths));
    return this._routes.get(key);
  }

  _ties(curve) {
    return tiePositions(curve).map(({ point, tangent }) => {
      const g = new THREE.CylinderGeometry(RADIUS + 0.0013, RADIUS + 0.0013, 0.008, 10);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
      return g.applyMatrix4(new THREE.Matrix4().compose(point, q, new THREE.Vector3(1, 1, 1)));
    });
  }

  _rebuild() {
    const parts = [];
    for (const c of this.cables) {
      const a = this.port(this.batch.ports.userData.names.indexOf(c.a));
      const b = this.port(this.batch.ports.userData.names.indexOf(c.b));
      parts.push(this._colored(this._tube(c.curve), c.color));
      parts.push(this._colored(this._plug(a), 0xd8dde3), this._colored(this._plug(b), 0xd8dde3));
      for (const t of this._ties(c.curve)) parts.push(this._colored(t, 0x161616)); // Klett-Kabelbinder
    }
    this.mesh.geometry.dispose();
    this.mesh.geometry = parts.length ? mergeGeometries(parts.map((g) => g.toNonIndexed()), false) : new THREE.BufferGeometry();
  }

  /** pro Frame: Vorschau von Port A zur Hand. */
  update(hover) {
    if (!this.pending) return;
    const a = this.port(this.pending.index);
    let r;
    if (this.awaiting) hover = { name: this.batch.ports.userData.names[this.awaiting.b], index: this.awaiting.b };
    if (hover && hover.name !== a.name) {
      r = this.route(a, this.port(hover.index)); // mit Kollisionssuche, gecacht pro Paar
      this.preview.material.opacity = r.blocked ? 0.3 : 0.75;
      if (r.blocked) r = routeCable(a.pos, a.normal, this.port(hover.index).pos, this.port(hover.index).normal);
    } else {
      this.preview.material.opacity = 0.75;
      r = routeCable(a.pos, a.normal, this.getHand(), a.normal); // schnell, ohne Huellen
    }
    if (r.blocked) return;
    this.preview.geometry.dispose();
    this.preview.geometry = this._tube(this._supported(r.curve));
  }

  /** Verbindungen fuer Szenario-Engine / Tests. */
  connections() {
    return this.cables.map(({ curve, ...c }) => ({ ...c }));
  }
}
