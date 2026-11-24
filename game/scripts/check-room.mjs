// Headless-Check Raum: Lightmap-Zuordnung + Kollision (Figur bleibt im Raum, nicht ins Rack,
// Kaltgang ueber die Tuer-Luecke erreichbar). Nutzt den Roh-GLB (Node: kein Draco/KTX2-Worker).
import { existsSync, readFileSync } from 'node:fs';
globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
const THREE = await import('three');
const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
const { prepareRoom, resolveCollisions } = await import('../src/room.js');

// Plan v3: leerer Raum v3 (8 x 6 m, Glasfront, Slots) - Racks kommen erst beim Einbau (placement.js)
const url = new URL('../../assets/out/room_v3.raw.glb', import.meta.url);
if (!existsSync(url)) {
  console.log('SKIP: raw GLB fehlt (blender -b -P blender/tasks/room_v3.py)');
  process.exit(0);
}
const buf = readFileSync(url);
const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
gltf.scene.updateMatrixWorld(true);
const room = prepareRoom(gltf.scene);
const { min, max } = room.bounds;
console.log('bounds', min.toArray().map((v) => +v.toFixed(2)), max.toArray().map((v) => +v.toFixed(2)));
console.log('lightmap', room.stats, 'colliders', room.colliders.length, 'camBlockers', room.cameraBlockers.length);
const manifest = JSON.parse(readFileSync(new URL('../../assets/out/room_v3.manifest.json', import.meta.url), 'utf8'));

const R = 0.25;
const inRect = (p, c) => p.x > c.x0 && p.x < c.x1 && p.z > c.z0 && p.z < c.z1;
const walk = (from, dir, meters) => {
  const p = from.clone();
  const step = dir.clone().normalize().multiplyScalar(0.02);
  for (let i = 0; i < meters / 0.02; i++) { p.add(step); resolveCollisions(p, R, room.colliders); }
  return p;
};
let ok = true;
const check = (name, cond, p = new THREE.Vector3()) => { ok &&= cond; console.log(`${cond ? 'OK  ' : 'FAIL'} ${name} -> (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`); };
check('Raum 8 x 6 m', Math.abs(max.x - min.x - 8) < 0.05 && Math.abs(max.z - min.z - 6) < 0.05, max);
const s = room.spawn.clone();
check('spawn frei', !room.colliders.some((c) => inRect(s, c)), s);
for (const [n, d] of [['-Z (Glasfront)', [0, 0, -1]], ['+Z', [0, 0, 1]], ['-X', [-1, 0, 0]], ['+X', [1, 0, 0]], ['diag', [-1, 0, -1]]]) {
  const p = walk(s, new THREE.Vector3(...d), 14);
  check(`wand ${n}`, p.x >= min.x + R - 1e-3 && p.x <= max.x - R + 1e-3 && p.z >= min.z + R - 1e-3 && p.z <= max.z - R + 1e-3, p);
}
check('Glasfront blockiert die Kamera', room.cameraBlockers.some((m) => /^glass_front/.test(m.name)));
check('Tisch ist Kollision + Kabelauflage', room.supports.length === 1);
check('8 Rack-Plaetze + 3 Tisch-Plaetze im Manifest', manifest.slots.filter((x) => x.kind === 'rack').length === 8
  && manifest.slots.filter((x) => x.kind === 'notebook').length === 3);
check('Slots als Nodes im GLB', manifest.slots.every((x) => gltf.scene.getObjectByName(x.node)));
// Plan v4 D: Pult mit festen Plaetzen, Gitterrinnen fuer Trunk-Wege, Durchgang hinter dem Pult
check('3 feste Plaetze auf dem Pult + Gitterrinnen', manifest.slots.filter((x) => x.kind === 'fixed' && x.vorlage).length === 3 && !!manifest.trays?.pole);
const desk = room.supports[0];
check('feste Plaetze liegen auf der Platte', manifest.slots.filter((x) => x.kind !== 'rack').every((x) => x.pos[0] > desk.min.x && x.pos[0] < desk.max.x
  && x.pos[2] > desk.min.z && x.pos[2] < desk.max.z && Math.abs(x.pos[1] - desk.max.y) < 0.01));
const behind = walk(new THREE.Vector3(4.4, 0, -5.6), new THREE.Vector3(1, 0, 0), 4);
check('Durchgang hinter dem Pult (Geraete-Rueckseiten)', behind.x > 7.2 && behind.z < desk.min.z, behind);
const sit = gltf.scene.getObjectByName('chair_1_sit');
check('Stuhl mit Sitzpunkt (0.47 m)', !!sit && Math.abs(sit.getWorldPosition(new THREE.Vector3()).y - 0.47) < 0.02);
check('keine Geraete im Raum (Plan v3)', manifest.devices.length === 0);
process.exit(ok ? 0 : 1);
