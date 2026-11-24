import * as THREE from 'three';

// Port-Nummern als Beschriftung am Geraet (eine InstancedMesh = 1 Draw Call, Ziffern-Atlas aus
// einem Canvas). Backen in die 1K-Panel-Textur waere unleserlich (2.1 px/mm -> 3-mm-Ziffer = 6 px).
// Platzierung wie bei echten Geraeten (Masse aus lib.devices, relativ zur Port-Oeffnung):
//   Switch RJ45: ungerade (obere Reihe) darueber, gerade darunter; SFP+: unter dem Kaefig;
//   MGMT/CON: darueber; Patchpanel: dunkel auf dem weissen Beschriftungsstreifen neben dem Strich.

const CELL_W = 96;
const CELL_H = 40;
const COLS = 10;
const LIGHT = new THREE.Color(0.96, 0.97, 0.98); // hell fuer Kontrast auf dunklen Frontplatten
const DARK = new THREE.Color(0.06, 0.06, 0.07);

function atlas(texts) {
  const rows = Math.ceil(texts.length / COLS);
  const c = document.createElement('canvas');
  c.width = CELL_W * COLS;
  c.height = 2 ** Math.ceil(Math.log2(CELL_H * rows));
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const rects = new Map();
  texts.forEach((t, i) => {
    const x = (i % COLS) * CELL_W;
    const y = Math.floor(i / COLS) * CELL_H;
    g.font = `bold ${t.length > 2 ? 24 : 32}px system-ui, sans-serif`;
    g.fillText(t, x + CELL_W / 2, y + CELL_H / 2 + 1);
    rects.set(t, [x / c.width, 1 - (y + CELL_H) / c.height, CELL_W / c.width, CELL_H / c.height]);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, rects };
}

/** Text, Hoehe (m), Versatz entlang der Port-Hochachse (m), seitlich (m), Farbe */
function layout(kind, id) {
  const n = Number(id);
  // Groessen 2026-11-19 angehoben (lesbar aus ~60 cm), so weit es die Frontplatte erlaubt
  if (kind === 'keystone') return { text: String(n), h: 0.005, dv: 0.0214, du: 0.0045, color: DARK };
  if (kind === 'rj45' && id === 'mgmt') return { text: 'MGMT', h: 0.003, dv: 0.0107, du: 0, color: LIGHT };
  if (kind === 'console') return { text: 'CON', h: 0.003, dv: 0.0093, du: 0, color: LIGHT };
  if (kind === 'sfp') return { text: String(n), h: 0.0035, dv: n % 2 ? -0.009 : -0.008, du: 0, color: LIGHT };
  return { text: String(n), h: 0.004, dv: n % 2 ? 0.0099 : -0.0093, du: 0, color: LIGHT }; // RJ45
}

export function addPortLabels(scene, batch) {
  const ports = batch.ports;
  if (!ports) return null;
  // nur Rack-Geraete mit Frontplatten-Beschriftung (Switch, Patchpanel); Notebooks haben keine
  const items = ports.userData.names.map((name, i) => {
    if (!/_(switch|coreswitch|patchpanel|router|firewall|outlet)_/.test(name)) return null;
    const ex = ports.userData.extras[i];
    if (ex.leyonet_port_label) { // Router/Firewall: Beschriftung (ETH0, WAN ...) ueber dem Port
      return { i, text: ex.leyonet_port_label, h: ex.leyonet_port_label.length > 3 ? 0.0028 : 0.0032,
        dv: ex.leyonet_port_kind === 'console' ? 0.0093 : 0.0097, du: 0, color: LIGHT };
    }
    return { i, ...layout(ex.leyonet_port_kind, ex.leyonet_port ?? name.split('_port_')[1]) };
  }).filter(Boolean);
  if (!items.length) return null; // Plan v3: (noch) keine beschrifteten Geraete eingebaut
  const { tex, rects } = atlas([...new Set(items.map((it) => it.text))]);
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aRect;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = vMapUv * aRect.zw + aRect.xy;');
  };
  const geo = new THREE.PlaneGeometry(1, 1);
  const rectAttr = new Float32Array(items.length * 4);
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  mesh.name = 'port_labels';
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const u = new THREE.Vector3();
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  items.forEach((it, k) => {
    ports.getMatrixAt(it.i, m);
    pos.setFromMatrixPosition(m);
    n.setFromMatrixColumn(m, 2).normalize();
    // oben = Welt-Hochachse (Geraete stehen aufrecht), rechts = aus Sicht des Betrachters;
    // die Matrixspalten sind nach Groesse sortiert (bei RJ45 ist Spalte 0 die Hoehe) - nicht nutzen
    v.set(0, 1, 0);
    u.crossVectors(v, n).normalize();
    const w = it.h * (CELL_W / CELL_H);
    const p = pos.clone().addScaledVector(v, it.dv).addScaledVector(u, it.du).addScaledVector(n, 0.0004);
    mesh.setMatrixAt(k, new THREE.Matrix4().makeBasis(u.clone().multiplyScalar(w), v.clone().multiplyScalar(it.h), n).setPosition(p));
    mesh.setColorAt(k, it.color);
    rectAttr.set(rects.get(it.text), k * 4);
  });
  geo.setAttribute('aRect', new THREE.InstancedBufferAttribute(rectAttr, 4));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.renderOrder = 1;
  scene.add(mesh);
  return mesh;
}
