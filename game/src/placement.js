import * as THREE from 'three';
import { isFrame } from './kern.js';
import { ownEnv, registerTextures, setOwnEnv } from './unify.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Plan v3: Bauen statt Vorfinden. Der Kern entscheidet ueber Einbau/Ausbau (Intents install /
// uninstall, docs/archiv/PLAN_V3.md) und schickt `placed` im Zustand. Hier:
// - buildDevices(placed): Bausatz-Vorlagen (kit.glb) klonen, nach Instanz umbenennen
//   (kit_switch -> r3_switch_U41, kit_rack -> rack_3, kit_rack_pdu_0u_L -> r3_pdu_0u_L) und auf
//   die Raum-Slots / Rack-Hoeheneinheiten setzen.
// - target(): was liegt vor dem Fadenkreuz fuer den Artikel in der Hand? Geister-Vorschau
//   (gruen = passt, rot = belegt) + Intent fuer E/Klick.

const REACH_RACK = 3.5; // m, Kopf -> Bodenpunkt eines Rack-Platzes
const REACH_DEVICE = 2.0; // m, Kopf -> Einbauhoehe im Rack
const REACH_DESK = 1.6;
const GHOST_OK = 0x22c55e;
const GHOST_BAD = 0xff5a5a;

export const HARDWARE = new Set(['rack', 'geraet', 'notebook']);
export const KIT_ENV = 2.0; // x scene.environmentIntensity (User-Entscheid 2026-11-23 nach Vergleich 1x/2x/3x)

export class Placement {
  /** kitScene: geladene kit.glb-Szene, kit: kit.kit.json, slots: Raum-Manifest slots */
  constructor({ scene, kitScene, kit, slots, trays = null }) {
    this.trays = trays; // Gitterrinnen (Raum-Manifest): Trunk-Wege ueber Kopf
    this.scene = scene;
    this.kit = new Map(kit.templates.map((t) => [t.node, t]));
    this.rackSpec = this.kit.get('kit_rack');
    this.slots = new Map(slots.map((s) => [s.node, s]));
    this.templates = new Map();
    for (const t of kit.templates) {
      const o = kitScene.getObjectByName(t.node);
      if (!o) throw new Error(`Bausatz: Vorlage ${t.node} fehlt in kit.glb`);
      this.templates.set(t.node, o);
    }
    // gltf-transform optimize flacht die Hierarchie ab: Overlays (LEDs, Ports, Displays), Deckel und Rack-PDUs
    // liegen als Wurzel-Nodes in der Szene. Alle Vorlagen sind im Ursprung exportiert -> wieder an die
    // Vorlage mit dem laengsten passenden Namenspraefix haengen (attach behaelt die Weltlage).
    registerTextures(kitScene); // gemeinsame Sets auch fuer Materialien, deren Basis gerade nicht verbaut ist
    // Bausatz hat keine Lightmap (Plan v3): Umgebungslicht (PMREM) fuer diese Materialien staerker, sonst
    // wirken schwarze Racks/Geraete neben dem gebackenen Raum wie Loecher (Ref-Vergleich 2026-11-20)
    setOwnEnv(KIT_ENV * scene.environmentIntensity);
    const seen = new Set();
    kitScene.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (seen.has(m) || !m.isMeshStandardMaterial) continue;
        seen.add(m);
        ownEnv(m, scene.environment);
      }
    });
    kitScene.updateMatrixWorld(true);
    const byLen = [...this.templates.keys()].sort((a, b) => b.length - a.length);
    for (const o of [...kitScene.children]) {
      if (this.templates.has(o.name)) continue;
      const owner = byLen.find((n) => o.name.startsWith(`${n}_`));
      if (owner) this.templates.get(owner).attach(o);
    }
    this.root = null; // aktuelle Geraete-Gruppe
    this.racks = new Map(); // rack node -> Object3D (fuer Zielwahl)
    this.placed = [];
    this.ray = new THREE.Raycaster();
    const mat = new THREE.MeshBasicMaterial({ color: GHOST_OK, transparent: true, opacity: 0.28, depthWrite: false });
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
    this.ghostEdges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: GHOST_OK, transparent: true, opacity: 0.9 }));
    this.ghost.add(this.ghostEdges);
    this.ghost.visible = false;
    this.ghost.renderOrder = 3;
    scene.add(this.ghost);
    this._v = new THREE.Vector3();
    this._p = new THREE.Plane();
  }

  _slotMatrix(sl) {
    return new THREE.Matrix4().compose(new THREE.Vector3(...sl.pos),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), sl.yaw), new THREE.Vector3(1, 1, 1));
  }

  _clone(tplNode, newName, partPrefix = null) {
    const src = this.templates.get(tplNode);
    const c = src.clone(true);
    c.traverse((o) => {
      if (o.name.startsWith(tplNode)) {
        // Rack-Teile: kit_rack_pdu_0u_L -> r3_pdu_0u_L, Gehaeuse kit_rack -> rack_3
        o.name = partPrefix && o.name.startsWith(`${tplNode}_`) && /_pdu_/.test(o.name)
          ? `${partPrefix}${o.name.slice(tplNode.length + 1)}`
          : newName + o.name.slice(tplNode.length);
      }
    });
    c.position.set(0, 0, 0);
    c.quaternion.identity();
    c.scale.set(1, 1, 1);
    return c;
  }

  /** Masse des Einbau-Gestells (Rack oder Pult-Gestell) zu seinem Node */
  _spec(node) {
    return node.startsWith('bench') ? this.kit.get('kit_bench') : this.rackSpec;
  }

  /** Geraete-Gruppe aus der Kern-Liste neu aufbauen. Rueckgabe: neue Gruppe (schon in der Szene). */
  buildDevices(placed) {
    if (this.root) {
      this.scene.remove(this.root);
      // gebuendelte Geometrie der alten Gruppe freigeben (Vorlagen im Bausatz sind eigene Geometrien)
      this.root.getObjectByName('room_batched')?.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    }
    this.placed = placed.map((p) => ({ ...p }));
    const root = new THREE.Group();
    root.name = 'devices';
    this.racks.clear();
    // zuerst Racks + Notebooks (Slots), dann Geraete in die Racks
    for (const p of placed.filter((q) => q.slot)) {
      const sl = this.slots.get(p.slot);
      if (!sl) continue;
      const idx = p.node.replace(/^(rack|t1_notebook)_/, '');
      const c = this._clone(p.vorlage, p.node, p.vorlage === 'kit_rack' ? `r${idx}_` : null);
      c.applyMatrix4(this._slotMatrix(sl));
      root.add(c);
      if (isFrame(p)) this.racks.set(p.node, c);
    }
    for (const p of placed.filter((q) => q.rack)) {
      const rack = this.racks.get(p.rack);
      if (!rack) continue;
      const { mount_gltf: mount, u: U } = this._spec(p.rack);
      const c = this._clone(p.vorlage, p.node);
      c.position.set(mount[0], mount[1] + (p.u - 1) * U, mount[2]);
      rack.add(c);
    }
    this.scene.add(root);
    root.updateMatrixWorld(true);
    this.root = root;
    // jetzt messen: batchRoom nimmt die Meshes gleich aus der Gruppe, danach waeren die Boxen leer
    this._rackRects = [...this.racks].filter(([node]) => node.startsWith('rack_')).map(([, r]) => {
      const b = new THREE.Box3().setFromObject(r);
      return { x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z };
    });
    return root;
  }

  /** Kollisionsrechtecke (XZ) der aufgestellten Racks */
  rackColliders() {
    return this._rackRects ?? [];
  }

  _occupied(rackNode, u, he) {
    return this.placed.some((p) => p.rack === rackNode && u <= p.u + p.he - 1 && p.u <= u + he - 1);
  }

  _showGhost(matrix, size, offset, ok) {
    const g = this.ghost;
    g.visible = true;
    g.matrixAutoUpdate = false;
    const local = new THREE.Matrix4().compose(offset, new THREE.Quaternion(), size);
    g.matrix.multiplyMatrices(matrix, local);
    g.matrixWorldNeedsUpdate = true;
    const col = ok ? GHOST_OK : GHOST_BAD;
    g.material.color.setHex(col);
    this.ghostEdges.material.color.setHex(col);
  }

  hide() { this.ghost.visible = false; }

  /**
   * Zielwahl fuer den Artikel `c` (Katalog) in der Hand. camera: Fadenkreuz, head: Kopfposition.
   * Rueckgabe null (kein Ziel) oder { ok, text, intent }.
   */
  target(c, camera, head) {
    this.hide();
    if (!c || !HARDWARE.has(c.typ)) return null;
    this.ray.setFromCamera(new THREE.Vector2(0, 0), camera);
    const r = this.ray.ray;
    const name = c.kurz ?? c.name;
    if (c.typ === 'rack') {
      this._p.set(new THREE.Vector3(0, 1, 0), 0);
      const hit = r.intersectPlane(this._p, this._v);
      if (!hit || hit.distanceTo(head) > REACH_RACK) return null;
      let best = null;
      for (const sl of this.slots.values()) {
        if (sl.kind !== 'rack') continue;
        const local = hit.clone().applyMatrix4(this._slotMatrix(sl).invert());
        const inside = Math.abs(local.x) <= 0.3 && local.z <= 0.15 && local.z >= -1.15;
        if (inside) { best = sl; break; }
      }
      if (!best) return null;
      const taken = this.placed.some((p) => p.slot === best.node);
      const spec = this.rackSpec;
      this._showGhost(this._slotMatrix(best), new THREE.Vector3(spec.width, spec.height, spec.depth),
        new THREE.Vector3(0, spec.height / 2, -spec.depth / 2), !taken);
      const label = `Platz ${best.row}${((best.index - 1) % 4) + 1}`;
      return taken ? { ok: false, text: `${label} ist belegt` }
        : { ok: true, text: `${name} → ${label} — E: aufstellen`, intent: { action: 'install', item: c.item, slot: best.node } };
    }
    if (c.typ === 'notebook') {
      const nbSlots = [...this.slots.values()].filter((s) => s.kind === 'notebook');
      if (!nbSlots.length) return null;
      this._p.set(new THREE.Vector3(0, 1, 0), -nbSlots[0].pos[1]);
      const hit = r.intersectPlane(this._p, this._v);
      if (!hit || hit.distanceTo(head) > REACH_DESK) return null;
      const best = nbSlots.map((s) => ({ s, d: Math.hypot(s.pos[0] - hit.x, s.pos[2] - hit.z) })).sort((a, b) => a.d - b.d)[0];
      if (!best || best.d > 0.35) return null;
      const taken = this.placed.some((p) => p.slot === best.s.node);
      this._showGhost(this._slotMatrix(best.s), new THREE.Vector3(0.33, 0.24, 0.23), new THREE.Vector3(0, 0.12, 0), !taken);
      return taken ? { ok: false, text: `Platz ${best.s.index} am Tisch ist belegt` }
        : { ok: true, text: `${name} → Tisch-Platz ${best.s.index} — E: hinstellen`, intent: { action: 'install', item: c.item, slot: best.s.node } };
    }
    // Geraet: Einbauhoehe im anvisierten Rack (Ebene der vorderen Schiene)
    const tpl = this.kit.get(c.vorlage);
    const he = Math.max(1, tpl?.he ?? 1);
    let best = null;
    for (const [node, rack] of this.racks) {
      const spec = this._spec(node);
      const [mx, my, mz] = spec.mount_gltf;
      const inv = rack.matrixWorld.clone().invert();
      const lr = r.clone().applyMatrix4(inv);
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -mz);
      const p = lr.intersectPlane(plane, new THREE.Vector3());
      if (!p || Math.abs(p.x - mx) > 0.26) continue;
      const u0 = Math.floor((p.y - my) / spec.u) + 1;
      if (u0 < 1 || u0 > spec.slots) continue;
      const world = p.clone().applyMatrix4(rack.matrixWorld);
      const dist = world.distanceTo(head);
      if (dist > REACH_DEVICE || (best && dist > best.dist)) continue;
      best = { node, rack, u: Math.min(u0, spec.slots - he + 1), dist };
    }
    if (!best) return null;
    const taken = this._occupied(best.node, best.u, he);
    const spec = this._spec(best.node);
    const [mx, my, mz] = spec.mount_gltf;
    const depth = tpl?.depth || 0.3;
    this._showGhost(best.rack.matrixWorld, new THREE.Vector3(0.483, he * spec.u - 0.0008, depth),
      new THREE.Vector3(mx, my + (best.u - 1) * spec.u + (he * spec.u) / 2, mz - depth / 2 + 0.002), !taken);
    const where = best.node.startsWith('bench') ? 'Pult-Gestell' : `Rack ${best.node.replace('rack_', '')}`;
    const hes = he > 1 ? `HE ${best.u}-${best.u + he - 1}` : `HE ${best.u}`;
    return taken ? { ok: false, text: `${where} · ${hes} ist belegt` }
      : { ok: true, text: `${name} → ${where} · ${hes} — E: einbauen`,
        intent: { action: 'install', item: c.item, rack: best.node, u: best.u } };
  }

  /** Weg eines Patchpanels nach oben: hinten heraus, durch die Dach-Einfuehrung, in die Gitterrinne (Welt-Punkte). */
  _riser(node, lane) {
    const p = this.placed.find((q) => q.node === node);
    const rack = p && this.racks.get(p.rack);
    if (!rack || !p.rack.startsWith('rack_')) return null;
    const { mount_gltf: [, my, mz], u } = this.rackSpec;
    const y = my + (p.u - 0.5) * u;
    const back = mz - (this.kit.get('kit_patchpanel')?.depth || 0.12) + 0.004; // bis in die Rueckseite des Panels
    const x = -0.09 + 0.06 * (lane % 4);
    const top = this.trays.z - 0.10;
    const pts = [[x, y, back], [x, y - 0.012, back - 0.10], [x, y - 0.015, -0.58]];
    if (y < 1.75) {
      pts.push([x, y + 0.12, -0.81]); // Bogen nach oben, dann hinten im Rack hoch (leicht unruhig, nie straff)
      for (let h = y + 0.5; h < 1.75; h += 0.45) pts.push([x + (pts.length % 2 ? 0.008 : -0.008), h, -0.83]);
      pts.push([x, 1.98, -0.82]);
    } else pts.push([x, 1.955, -0.72], [x, 2.04, -0.81]);
    // ueber die Seitenwand der Rinne und ueber die Strom-Spur hinweg in die eigene Spur
    pts.push([x, top, -0.80], [x, this.trays.z + 0.03, -0.765], [x, this.trays.z + 0.066, -0.70], [x, this.trays.z + 0.058, -0.63]);
    const row = this.slots.get(p.slot ?? `slot_rack_${p.rack.replace('rack_', '')}`)?.row ?? 'A';
    return { row, pts: pts.map(([a, b, c]) => new THREE.Vector3(a, b, c).applyMatrix4(rack.matrixWorld)) };
  }

  /**
   * Alles ueber Kopf: Zuleitungen der Rack-PDUs (feedPath), Trunk-Buendel und Leitung der Tischdose: Patchpanel -> Rackdach -> Gitterrinne (Reihe, Querverbindung) ->
   * anderes Rack bzw. Energiesaeule am Pult. Regel 5: CatmullRom mit leichtem Durchhang, Kabelbinder alle ~30 cm.
   * trunks: Kern-Zustand, nodeOf(id) -> GLB-Node (Manifest).
   */
  drawTrunks(trunks, nodeOf) {
    if (this.trunkMesh) {
      this.scene.remove(this.trunkMesh);
      this.trunkMesh.geometry.dispose();
      this.trunkMesh = null;
    }
    if (!this.trays) return;
    const geoms = this.feedGeometries();
    const blue = new THREE.Color(0x1f4fa8);
    (trunks ?? []).forEach((t, lane) => {
      const path = this.trunkPath(t, nodeOf, lane);
      if (!path) return;
      const curve = new THREE.CatmullRomCurve3(path, false, 'centripetal');
      const len = curve.getLength();
      const r = t.desk ? 0.009 : 0.014; // 8 statt 24 Leitungen
      geoms.push(tinted(new THREE.TubeGeometry(curve, Math.ceil(len * 22), r, 8, false), blue));
      for (let sx = 0.3; sx < len - 0.15; sx += 0.3) { // Kabelbinder (Klett)
        const ring = new THREE.TorusGeometry(r + 0.0025, 0.003, 4, 10);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), curve.getTangentAt(sx / len));
        ring.applyMatrix4(new THREE.Matrix4().compose(curve.getPointAt(sx / len), q, new THREE.Vector3(1, 1, 1)));
        geoms.push(tinted(ring, blue));
      }
    });
    if (!geoms.length) return;
    this.trunkMesh = new THREE.Mesh(mergeTubes(geoms), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }));
    this.trunkMesh.name = 'trunks';
    this.scene.add(this.trunkMesh);
  }

  /**
   * Zuleitung einer Rack-PDU (Welt-Punkte): Abgangskasten an der Decke -> Strom-Spur der Gitterrinne -> ueber die Seitenwand ->
   * Dach-Einfuehrung -> PDU oben. side -1 = L (Feed A), +1 = R (Feed B). Rueckgabe { row, order, side, pts } oder null.
   */
  feedPath(node, side) {
    const p = this.placed.find((q) => q.node === node);
    const rack = this.racks.get(node);
    const sl = this.slots.get(p?.slot);
    const tap = this.trays?.power?.taps?.[sl?.row];
    if (!rack || !tap) return null;
    const sgn = sl.row === 'A' ? 1 : -1; // Seite der Dach-Einfuehrung
    const n = (sl.index - 1) % 4; // 0 = naechstes Rack am Kasten: aeusserste Spalte, verlaesst die Rinne zuerst
    const layer = side < 0 ? 1 : 0;
    const z = this.trays.rows[sl.row] + sgn * (0.125 - 0.014 * n);
    const y = this.trays.z - 0.019 + 0.0125 * layer;
    const gx = tap[0] + (layer ? -0.015 : 0.015), gz = tap[1] + sgn * (1.5 - n) * 0.021; // Verschraubung (Raster props.build_power_box)
    const { z: zBox } = this.trays.power;
    const world = (a, b, c) => new THREE.Vector3(a, b, c).applyMatrix4(rack.matrixWorld);
    // Spiegelung: Reihe A ist um 180 Grad gedreht - side meint immer die Rack-Seite (L/R)
    const out = world(side * 0.135, 0, 0).x;
    const pts = [new THREE.Vector3(gx, zBox + 0.012, gz), new THREE.Vector3(gx, zBox - 0.06, gz), new THREE.Vector3(gx + 0.004, zBox - 0.25, (gz + z) / 2),
      new THREE.Vector3(gx + 0.012, y + 0.14, z), new THREE.Vector3(gx + 0.05, y + 0.035, z), new THREE.Vector3(gx + 0.12, y, z)];
    const x0 = gx + 0.12, x1 = out - 0.11;
    const steps = Math.max(1, Math.round((x1 - x0) / 0.4));
    for (let i = 1; i <= steps; i++) pts.push(new THREE.Vector3(x0 + ((x1 - x0) * i) / steps, y + (i % 2 ? -0.003 : 0.003), z)); // leichter Durchhang
    const tz = this.trays.z;
    pts.push(new THREE.Vector3(out - 0.045, tz + 0.02, z + sgn * 0.004));
    const loc = [[0.135, tz + 0.052, -0.655], [0.135, tz + 0.03, -0.715], [0.135, tz - 0.07, -0.755], [0.135, 2.15, -0.762], [0.135, 2.0, -0.775],
      [0.140, 1.955, -0.805], [0.165, 1.925, -0.865], [0.215, 1.917, -0.908], [0.258, 1.912, -0.920], [0.272, 1.895, -0.920], [0.273, 1.865, -0.920]];
    for (const [a, b, c] of loc) pts.push(world(side * a, b, c));
    return { row: sl.row, order: n, side, pts };
  }

  /** Zuleitungen aller aufgestellten Racks + Kabelbinder um das Buendel in der Rinne (alle ~30 cm, Regel 5) */
  feedGeometries() {
    const geoms = [];
    if (!this.trays?.power) return geoms;
    const black = new THREE.Color(0x0c0c0e);
    const ends = {}; // Reihe -> am weitesten laufende Leitung
    for (const p of this.placed.filter((q) => q.vorlage === 'kit_rack')) {
      for (const side of [-1, 1]) {
        const f = this.feedPath(p.node, side);
        if (!f) continue;
        const curve = new THREE.CatmullRomCurve3(f.pts, false, 'centripetal');
        geoms.push(tinted(new THREE.TubeGeometry(curve, Math.ceil(curve.getLength() * 20), 0.006, 6, false), black));
        const reach = new THREE.Vector3(0, 0, -0.1).applyMatrix4(this.racks.get(p.node).matrixWorld).x;
        (ends[f.row] ??= []).push({ reach, order: f.order });
      }
    }
    for (const [row, list] of Object.entries(ends)) {
      const sgn = row === 'A' ? 1 : -1;
      const far = Math.max(...list.map((e) => e.reach)) - 0.3;
      for (let x = this.trays.power.taps[row][0] + 0.22; x < far; x += 0.3) {
        const cols = list.filter((e) => e.reach - 0.3 > x).map((e) => 0.125 - 0.014 * e.order); // Spalten, die hier noch liegen
        if (!cols.length) continue;
        const a = Math.min(...cols) - 0.0085, b = Math.max(...cols) + 0.0085;
        const ring = new THREE.TorusGeometry(1, 0.1, 4, 12);
        ring.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, this.trays.z - 0.0128, this.trays.rows[row] + sgn * (a + b) / 2),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), new THREE.Vector3((b - a) / 2 + 0.002, 0.0155, 0.02)));
        geoms.push(tinted(ring, black));
      }
    }
    return geoms;
  }

  /** Punkte eines Trunks (Welt) oder null. t = { a, b, desk? }; lane = Spur in der Rinne */
  trunkPath(t, nodeOf, lane = 0) {
    const tr = this.trays;
    const off = [0.004, -0.028, 0.03, -0.06][lane % 4]; // neben der Strom-Spur (+-0.083..0.125)
    const y = tr.z + 0.006 + 0.026 * Math.floor(lane / 4);
    const from = this._riser(nodeOf(t.desk ? t.b : t.a), lane);
    const to = t.desk ? null : this._riser(nodeOf(t.b), lane);
    if (!from || (!t.desk && !to)) return null;
    const zA = tr.rows[from.row] + off;
    const endRow = t.desk ? 'B' : to.row; // die Rinne zum Pult zweigt von Reihe B ab
    const zB = tr.rows[endRow] + off;
    const xA = from.pts.at(-1).x;
    const xB = t.desk ? tr.pole[0] + off : to.pts.at(-1).x;
    const legs = [[xA, zA]];
    if (from.row !== endRow) legs.push([tr.cross_x + off, zA], [tr.cross_x + off, zB]);
    legs.push([xB, zB]);
    if (t.desk) legs.push([xB, tr.pole[1] + 0.05]);
    const pts = [...from.pts];
    let n = 0;
    legs.forEach(([x, z], k) => {
      if (k === 0) { // aus dem Riser rund in die Spur (nicht rechtwinklig)
        const d = Math.sign(legs[1][0] - x) || 1;
        pts.push(new THREE.Vector3(x + d * 0.045, y + 0.016, z + (pts.at(-1).z - z) * 0.22));
        return;
      }
      const [px, pz] = legs[k - 1];
      const len = Math.hypot(x - px, z - pz);
      // Ecken rund (15 cm vor/nach dem Knick), dazwischen alle ~40 cm ein Stuetzpunkt mit leichtem Durchhang
      const e = Math.min(0.15, len / 3);
      const at = (d) => new THREE.Vector3(px + ((x - px) * d) / len, y + (n++ % 2 ? 0.003 : -0.004), pz + ((z - pz) * d) / len);
      if (len < 0.05) return;
      for (let d = e; d < len - e + 1e-6; d += Math.max(0.2, (len - 2 * e) / Math.max(1, Math.round((len - 2 * e) / 0.4)))) pts.push(at(d));
      if (k === legs.length - 1) {
        if (t.desk) pts.push(new THREE.Vector3(x, y, z));
        else pts.push(new THREE.Vector3(x + (Math.sign(px - x) || 1) * 0.045, y + 0.016, z + (to.pts.at(-1).z - z) * 0.22));
      }
    });
    if (t.desk) pts.push(new THREE.Vector3(xB - off, y + 0.01, tr.pole[1] + 0.028)); // in den Kabelauslass der Saeule
    else pts.push(...[...to.pts].reverse());
    return pts;
  }

  /** Eingebautes Objekt zu einem Treffer-Namen (laengster passender Node), sonst null */
  entryOf(name) {
    if (!name) return null;
    let best = null;
    for (const p of this.placed) {
      if ((name === p.node || name.startsWith(`${p.node}_`)) && (!best || p.node.length > best.node.length)) best = p;
    }
    // PDU-Teile gehoeren zum Rack
    const pdu = /^r(\d+)_pdu_/.exec(name);
    if (!best && pdu) best = this.placed.find((p) => p.node === `rack_${pdu[1]}`) ?? null;
    return best;
  }
}

/** Farbe als Vertexfarbe: Trunks (blau) und Zuleitungen (schwarz) bleiben EIN Draw Call */
function tinted(g, c) {
  const n = g.attributes.position.count;
  const f = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) f.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(f, 3));
  return g;
}

function mergeTubes(geoms) {
  const flat = geoms.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of flat) for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  return mergeGeometries(flat, false);
}
