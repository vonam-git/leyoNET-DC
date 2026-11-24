// Headless-Check Kabel: Laenge = Standardlaenge, Durchhang > 0 (nie straff), gerader Auslauf
// aus dem Port, > 5 m -> abgelehnt.
const THREE = await import('three');
import { existsSync, readFileSync } from 'node:fs';
globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
const { routeCable, LENGTHS, cableCollision, tiePositions, deviceHulls } = await import('../src/cables.js');
const { quadMatrix } = await import('../src/batch.js');
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const n = V(1, 0, 0); // Rack-Front zeigt nach +X (Kaltgang)
let ok = true;
const check = (name, cond, extra = '') => { ok &&= cond; console.log(`${cond ? 'OK  ' : 'FAIL'} ${name} ${extra}`); };
for (const [label, a, b] of [
  ['U41 -> U42 (1 HE)', V(1.6, 1.87, -1.7), V(1.6, 1.915, -1.65)],
  ['U41 -> U38 quer', V(1.6, 1.87, -1.8), V(1.6, 1.735, -1.45)],
  ['Rack -> Boden 2 m', V(1.6, 1.9, -1.7), V(1.6, 0.2, -1.4)],
]) {
  const r = routeCable(a, n, b, n);
  const len = r.curve.getLength();
  check(`${label}: Standardlaenge`, LENGTHS.includes(r.length) && Math.abs(len - r.length) / r.length < 0.01,
    `(${r.length} m, Kurve ${len.toFixed(3)} m, min ${r.minLen.toFixed(3)} m)`);
  check(`${label}: Durchhang > 0`, r.sag > 0.005, `(sag ${r.sag.toFixed(3)} m)`);
  const t = r.curve.getTangent(0.01);
  check(`${label}: gerader Auslauf`, t.dot(n) > 0.9, `(tangent.n ${t.dot(n).toFixed(2)})`);
}
check('> 5 m abgelehnt', routeCable(V(0, 1, 0), n, V(6, 1, 0), n.clone().negate()).blocked === true);

// --- Kollision synthetisch: 1U-Kabelmanager mit Ringen ragt 15 cm vor die Front zwischen den Ports
// (im aktuellen Raum ragt nichts so weit vor - Server-Bezel 25 mm < 6 cm Auslauf)
{
  const a = V(1.6, 1.9, -1.7), b = V(1.6, 1.2, -1.7);
  const hull = [{ name: 'cable_manager', box: new THREE.Box3(V(1.55, 1.5, -1.95), V(1.75, 1.6, -1.45)) }];
  const naive = routeCable(a, n, b, n);
  const r = routeCable(a, n, b, n, hull);
  check('synthetisch: naiv kollidiert', !!cableCollision(naive.curve, hull), `(${cableCollision(naive.curve, hull)?.hull})`);
  check('synthetisch: Route frei', !r.blocked && !cableCollision(r.curve, hull), `(${r.length} m, Woelbung +${r.out?.toFixed(2)} m)`);
  const wall = [{ name: 'wand', box: new THREE.Box3(V(1.62, 1.0, -3), V(3, 2.2, 0)) }];
  const rb = routeCable(a, n, b, n, wall);
  check('synthetisch: kein freier Weg -> abgelehnt mit Grund', rb.blocked && /wand/.test(rb.reason), `(${rb.reason})`);
  check('synthetisch: Kabelbinder ~30 cm', tiePositions(r.curve).length === Math.floor((r.length - 0.08) / 0.3),
    `(${tiePositions(r.curve).length} bei ${r.length} m)`);
}

// --- Kollision im echten Rack (Roh-GLB): alle Switch -> Patchpanel-Paare -----------------------
const url = new URL('../../assets/out/test_room_rack_pbr.raw.glb', import.meta.url);
if (!existsSync(url)) {
  console.log('SKIP Rack-Test: raw GLB fehlt');
} else {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const buf = readFileSync(url);
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  gltf.scene.updateMatrixWorld(true);
  const hulls = deviceHulls(gltf.scene);
  const ports = new Map();
  gltf.scene.traverse((o) => {
    if (o.isMesh && o.userData.leyonet_overlay === 'port') {
      const m = quadMatrix(o);
      ports.set(o.name, { pos: new THREE.Vector3().setFromMatrixPosition(m),
        normal: new THREE.Vector3().setFromMatrixColumn(m, 2).normalize() });
    }
  });
  const sw = ['coreswitch_U37', 'switch_U39', 'switch_U41'], pp = ['U38', 'U40', 'U42']; // U37 = Core-Switch (L7)
  let pairs = 0, free = 0, naiveHits = 0, blocked = [];
  const lens = {};
  for (const s1 of sw) for (const p1 of pp) for (let k = 1; k <= 24; k++) {
    const id = String(k).padStart(2, '0');
    const a = ports.get(`r1_${s1}_port_${id}`), b = ports.get(`r1_patchpanel_${p1}_port_${id}`);
    pairs++;
    const naive = routeCable(a.pos, a.normal, b.pos, b.normal);
    if (!naive.blocked && cableCollision(naive.curve, hulls)) naiveHits++;
    const r = routeCable(a.pos, a.normal, b.pos, b.normal, hulls);
    if (r.blocked) { blocked.push(`${s1}/${id}->${p1}`); continue; }
    if (!cableCollision(r.curve, hulls)) free++;
    lens[r.length] = (lens[r.length] ?? 0) + 1;
  }
  console.log(`     Rack: ${hulls.length} Geraete-Huellen, ${pairs} Paare, naiv kollidierend ${naiveHits}, Laengen ${JSON.stringify(lens)}`);
  check('Rack: alle Routen frei oder begruendet abgelehnt', free + blocked.length === pairs,
    `(frei ${free}, abgelehnt ${blocked.length}${blocked.length ? ': ' + blocked.slice(0, 4).join(', ') : ''})`);
}
process.exit(ok ? 0 : 1);
