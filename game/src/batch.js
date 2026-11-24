import * as THREE from 'three';
import { registerTextures, unify } from './unify.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Draw-Call-Reduktion beim Laden (Ziel < 50 fuer die Gesamtszene):
// 1. LED-Quads (<geraet>_led_*)  -> EINE InstancedMesh, Zustand = Instanzfarbe
// 2. Port-Quads (<geraet>_port_*) -> EINE InstancedMesh (Raycast-Ziel)
// 3. alle uebrigen statischen Meshes -> pro Material zusammengefuehrt
// Namen bleiben adressierbar: instanceId -> userData.names[instanceId]; Merge-Meshes tragen
// userData.sources = [{ name, start, count }] (Index-Bereiche pro Quellobjekt).
// Die Original-Meshes werden aus dem Szenengraph entfernt, bleiben aber (mit gueltiger
// matrixWorld) fuer Kamera-Kollision / Raycast nutzbar.

const LED_STATES = ['on', 'act', 'off'];

/** Instanz-Matrix eines achsparallelen Quads (im Mesh-Lokalraum) fuer ein Einheits-Quad XY/+Z. */
export function quadMatrix(mesh) {
  const g = mesh.geometry;
  g.computeBoundingBox();
  const { min, max } = g.boundingBox;
  const size = new THREE.Vector3().subVectors(max, min);
  const center = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);
  const axes = [0, 1, 2].sort((a, b) => size.getComponent(a) - size.getComponent(b));
  const [nAx, uAx, vAx] = axes; // duennste Achse = Normale
  const e = (i) => new THREE.Vector3().setComponent(i, 1);
  const n = e(nAx);
  const nAttr = g.getAttribute('normal');
  if (nAttr && nAttr.getComponent(0, nAx) < 0) n.negate();
  const u = e(uAx).multiplyScalar(size.getComponent(uAx));
  let v = e(vAx).multiplyScalar(size.getComponent(vAx));
  if (new THREE.Vector3().crossVectors(u, v).dot(n) < 0) v = v.negate(); // rechtshaendig, det > 0
  const local = new THREE.Matrix4().makeBasis(u, v, n).setPosition(center);
  return new THREE.Matrix4().multiplyMatrices(mesh.matrixWorld, local);
}

function ledColor(mat) {
  const e = mat.emissive;
  if (e && (e.r > 0 || e.g > 0 || e.b > 0)) return e.clone().multiplyScalar(mat.emissiveIntensity ?? 1);
  return mat.color.clone();
}

function instanced(meshes, material, kind) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const im = new THREE.InstancedMesh(geo, material, meshes.length);
  im.name = `${kind}_instances`;
  im.userData.names = [];
  im.userData.extras = [];
  meshes.forEach((m, i) => {
    im.setMatrixAt(i, quadMatrix(m));
    im.userData.names.push(m.name);
    im.userData.extras.push({ ...m.userData });
  });
  im.instanceMatrix.needsUpdate = true;
  if (meshes.length) im.computeBoundingSphere();
  else im.visible = false;
  return im;
}

function attrSignature(g) {
  return Object.keys(g.attributes)
    .sort()
    .map((k) => `${k}:${g.attributes[k].itemSize}:${g.attributes[k].normalized}`)
    .join('|');
}

/**
 * Buendelt den Raum-GLB. Rueckgabe: { leds, ports, merged, stats, setLed(name, state) }.
 * `root` muss bereits in der Szene haengen (matrixWorld aktuell).
 */
export function batchRoom(root) {
  root.updateMatrixWorld(true);
  const leds = [];
  const ports = [];
  const statics = [];
  const screens = []; // Notebook-Displays: bleiben einzeln (das Spiel zeichnet pro Geraet darauf)
  root.traverse((o) => {
    if (!o.isMesh) return;
    const kind = o.userData.leyonet_overlay;
    if (kind === 'led') leds.push(o);
    else if (kind === 'port') ports.push(o);
    else if (kind === 'screen') screens.push(o);
    else if (kind === 'kvm') { o.visible = false; screens.push(o); } // unsichtbare Klickflaeche (Raycast trifft trotzdem)
    else statics.push(o);
  });
  const before = leds.length + ports.length + statics.length;

  // 1. LEDs: unlit, Farbe pro Instanz (HDR > 1 fuer spaeteres Bloom), beidseitig (Rueck-LEDs)
  const ledMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  // Plan v3: auch ohne LEDs/Ports (leerer Raum) existieren beide InstancedMeshes (count 0)
  const ledMesh = instanced(leds, ledMat, 'led');
  // Farben aus den GLB-Materialien: led_off / led_amber global, "on" = eigene Farbe der LED
  const byMat = {};
  for (const m of leds) byMat[m.material.name] ??= ledColor(m.material);
  const offColor = byMat.led_off ?? new THREE.Color(0.06, 0.07, 0.06);
  const actColor = byMat.led_amber ?? new THREE.Color(3, 1.65, 0.15);
  const onColors = [];
  if (leds.length) {
    leds.forEach((m, i) => {
      ledMesh.setColorAt(i, ledColor(m.material));
      const own = m.material.name;
      onColors.push(own === 'led_off' || own === 'led_amber' ? (byMat.led_green ?? actColor) : byMat[own]);
    });
    ledMesh.instanceColor.needsUpdate = true;
  }
  const ledIndex = new Map((ledMesh?.userData.names ?? []).map((n, i) => [n, i]));

  // 2. Ports: Material des ersten Port-Quads (port_black, ohne Lightmap)
  const portMesh = instanced(ports, ports[0]?.material ?? new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.85 }), 'port');

  // 3. statische Meshes pro Material + Attribut-Signatur zusammenfuehren
  //    Materialien mit demselben Textur-Set vorher zusammenlegen (unify.js), der Rest pro Material
  registerTextures(root);
  const uni = unify(statics);
  const groups = new Map();
  for (const m of uni.rest) {
    const key = `${m.material.uuid}#${attrSignature(m.geometry)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  const merged = uni.groups.map((g) => makeMerged(g.geoms, g.sources, g.material));
  for (const list of groups.values()) {
    if (list.length === 1) {
      const m = list[0];
      const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
      merged.push(makeMerged([g], [m], m.material));
      continue;
    }
    const anyIndexed = list.some((m) => m.geometry.index);
    const allIndexed = list.every((m) => m.geometry.index);
    const geoms = list.map((m) => {
      let g = m.geometry.clone().applyMatrix4(m.matrixWorld);
      if (anyIndexed && !allIndexed) g = g.toNonIndexed();
      return g;
    });
    merged.push(makeMerged(geoms, list, list[0].material));
  }

  // Originale aus dem Graph loesen (bleiben fuer Raycast/Kollision gueltig), Batches einhaengen
  for (const m of [...leds, ...ports, ...statics]) m.parent?.remove(m);
  const out = new THREE.Group();
  out.name = 'room_batched';
  for (const m of merged) out.add(m);
  if (ledMesh) out.add(ledMesh);
  if (portMesh) out.add(portMesh);
  root.add(out);

  const stats = { meshesBefore: before + screens.length, drawablesAfter: merged.length + !!ledMesh + !!portMesh + screens.length,
    leds: leds.length, ports: ports.length, merged: merged.length, screens: screens.length };

  function setLed(name, state) {
    const i = ledIndex.get(name);
    if (i === undefined || !LED_STATES.includes(state)) return false;
    ledMesh.setColorAt(i, state === 'off' ? offColor : state === 'act' ? actColor : onColors[i]);
    ledMesh.instanceColor.needsUpdate = true;
    return true;
  }
  return { leds: ledMesh, ports: portMesh, merged, screens, stats, setLed };
}

function makeMerged(geoms, sources, material) {
  const g = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false);
  if (!g) throw new Error(`merge failed for material ${material.name}`);
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, material);
  mesh.name = `merged_${material.name}`;
  let start = 0;
  mesh.userData.sources = sources.map((s, i) => {
    const cnt = geoms[i].index ? geoms[i].index.count : geoms[i].attributes.position.count;
    const r = { name: s.name, start, count: cnt };
    start += cnt;
    return r;
  });
  return mesh;
}

/** Raycast-Treffer -> adressierbarer Name (<geraet>_port_<nn>, <geraet>_led_*, Quellobjekt). */
export function hitName(hit) {
  const o = hit.object;
  if (o.isInstancedMesh && hit.instanceId !== undefined) return o.userData.names[hit.instanceId];
  const src = o.userData.sources;
  if (src && hit.faceIndex !== undefined) {
    const idx = hit.faceIndex * 3;
    return src.find((s) => idx >= s.start && idx < s.start + s.count)?.name;
  }
  return o.name;
}
