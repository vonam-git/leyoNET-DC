import * as THREE from 'three';
import TINTS from './tints.json' with { type: 'json' }; // blender/tasks/tints.py: Toenung der Materialien mit eigener Albedo-Kopie

// Draw Calls senken (Plan v4): Viele Materialien teilen dasselbe ambientCG-Set und unterscheiden sich nur in Toenung, Rauheit,
// Metall und UV-Skalierung. Hier werden sie zu EINEM Material je Set (und Lightmap) zusammengelegt:
//   Toenung -> Vertexfarbe (float, darf > 1 sein; bei Glas mit Deckkraft als Alpha), Rauheit/Metall -> Attribut aRM,
//   Emission -> Attribut aEm, UV-Skalierung -> UVs. Wear-Materialien (eigene ORM) bleiben eigene Gruppen.
// Das Ergebnis pro Pixel bleibt gleich; nur die Albedo-Kopien (`<name>_Color`) werden durch Set-Textur x Toenung ersetzt.

/** Texturen mit gleichem Namen (Raum-GLB und Bausatz-GLB bringen dieselben Sets mit) -> die erste gilt. */
const textures = new Map();
export function registerTextures(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      for (const t of [m.map, m.normalMap, m.roughnessMap]) if (t?.name && !textures.has(t.name)) textures.set(t.name, t);
    }
  });
}
/** Sehr dunkle Set-Textur (Plastic012A, Mittel 0.02): als gemeinsame Textur die helle Kopie, sonst verstaerkt die Toenung (x38) die
 *  Kompressionsfehler. Faktoren beziehen sich dann auf diese Kopie. */
const BRIGHT = { Plastic012A_1024_Color: 'desk_hpl' };
/** Albedo-Textur + Toenung eines Materials: { map, tint } */
function albedo(m) {
  if (!m.map) return { map: null, tint: [1, 1, 1] };
  const own = TINTS[baseName(m.name)];
  const set = own?.map ?? m.map.name;
  const f = own?.tint ?? [1, 1, 1];
  const bright = BRIGHT[set];
  const bt = bright && textures.get(`${bright}_Color`);
  if (bt) return { map: bt, tint: f.map((v, i) => v / TINTS[bright].tint[i]) };
  const st = own ? textures.get(set) : null;
  return own && st ? { map: st, tint: f } : { map: canon(m.map), tint: [1, 1, 1] };
}
const canon = (t) => (t ? textures.get(t.name) ?? t : null);
const baseName = (n) => n.replace(/__\w+$/, '');

/** Textur ohne UV-Transformation (die steckt in den UVs); teilt Bilddaten und GPU-Textur mit dem Original. */
const plain = new Map();
function untransformed(t) {
  if (!t) return null;
  if (!plain.has(t)) {
    const c = t.clone();
    c.repeat.set(1, 1);
    c.offset.set(0, 0);
    c.rotation = 0;
    c.matrixAutoUpdate = true;
    c.updateMatrix();
    plain.set(t, c);
  }
  return plain.get(t);
}

/** Zusammenlegbar? -> { key, map, normal, orm, tint } oder null (bleibt eigenes Material) */
function plan(mesh) {
  const m = mesh.material;
  if (!m.isMeshStandardMaterial || m.isMeshPhysicalMaterial || /led_diffuser|_panel$/.test(m.name)) return null; // Licht schaltbar / eigene Atlanten
  if (m.map?.channel) return null; // Graffiti: Farbe auf eigenen UVs
  if (m.emissiveMap || m.aoMap || m.metalnessMap?.source !== m.roughnessMap?.source || mesh.geometry.attributes.color) return null;
  const uv = !!mesh.geometry.attributes.uv;
  if (m.map && !uv) return null;
  const { map, tint } = albedo(m);
  const normal = canon(m.normalMap);
  const orm = canon(m.roughnessMap);
  const lm = m.lightMap && mesh.geometry.attributes.uv1 ? m.lightMap : null;
  if (!map && (normal || orm)) return null;
  const key = [map?.name ?? '-', normal?.name ?? '-', orm?.name ?? '-', lm ? lm.source.uuid : '-', lm ? m.lightMapIntensity.toFixed(4) : '-',
    m.transparent ? `T${m.depthWrite}` : '', m.alphaTest, m.side, m.envMap?.uuid ?? '-', m.normalScale?.x, m.normalScale?.y].join('|');
  return { key, map, normal, orm, lm, tint };
}

/** Materialien mit eigener Umgebung (Bausatz ohne Lightmap). three nimmt envMapIntensity nur, wenn das Material selbst eine envMap
 *  hat - sonst gilt scene.environmentIntensity. Der Lichtschalter regelt alle gemeinsam (setOwnEnv). */
const ownEnvMats = new Set();
let ownEnvLevel = 1;
export function ownEnv(m, envMap) {
  m.envMap = envMap;
  m.envMapIntensity = ownEnvLevel;
  ownEnvMats.add(m);
}
export function setOwnEnv(level) {
  ownEnvLevel = level;
  for (const m of ownEnvMats) m.envMapIntensity = level;
}

const PATCH_KEY = 'leyonet-uni';
function patch(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec4 aRM;\nattribute vec3 aEm;\nvarying vec2 vRM;\nvarying vec3 vEm;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRM = aRM.xy;\nvEm = aEm;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vRM;\nvarying vec3 vEm;')
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= vRM.x;')
    .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= vRM.y;')
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vEm;');
}
const materials = new Map(); // Schluessel -> Material (bleibt ueber Neuaufbauten der Geraete-Gruppe bestehen)
function material(p, src) {
  if (!materials.has(p.key)) {
    const m = new THREE.MeshStandardMaterial({ name: `uni_${p.map?.name ?? 'flach'}`, map: untransformed(p.map), normalMap: untransformed(p.normal), roughnessMap: untransformed(p.orm),
      metalnessMap: untransformed(p.orm), roughness: 1, metalness: 1, vertexColors: true, side: src.side, transparent: src.transparent,
      depthWrite: src.depthWrite, alphaTest: src.alphaTest, envMap: src.envMap });
    if (src.envMap) ownEnv(m, src.envMap);
    if (src.normalScale) m.normalScale.copy(src.normalScale);
    if (p.lm) { m.lightMap = p.lm; m.lightMapIntensity = src.lightMapIntensity; }
    m.onBeforeCompile = patch;
    m.customProgramCacheKey = () => PATCH_KEY;
    materials.set(p.key, m);
  }
  return materials.get(p.key);
}

/** Geometrie in Weltkoordinaten mit eingerechneter UV-Skalierung und Attributen; Attribut-Satz je Schluessel einheitlich. */
function bake(mesh, p) {
  const m = mesh.material;
  const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  const n = g.attributes.position.count;
  const keep = new Set(['position', 'normal', ...(p.map ? ['uv'] : []), ...(p.lm ? ['uv1'] : [])]);
  for (const k of Object.keys(g.attributes)) if (!keep.has(k)) g.deleteAttribute(k);
  for (const k of keep) { // quantisierte Attribute (Draco) -> float, sonst lassen sich die Teile nicht zusammenfuegen
    const a = g.attributes[k];
    if (!a || (a.array instanceof Float32Array && !a.isInterleavedBufferAttribute && !a.normalized)) continue;
    const f = new Float32Array(n * a.itemSize);
    for (let i = 0; i < n; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = a.getComponent(i, c);
    g.setAttribute(k, new THREE.BufferAttribute(f, a.itemSize));
  }
  if (p.map) {
    const t = m.map;
    if (t.matrixAutoUpdate) t.updateMatrix();
    g.attributes.uv.applyMatrix3(t.matrix);
  }
  const fill = (size, v) => {
    const f = new Float32Array(n * size);
    for (let i = 0; i < n; i++) f.set(v, i * size);
    return new THREE.BufferAttribute(f, size);
  };
  const c = m.color;
  const tn = p.tint;
  const rgb = [c.r * tn[0], c.g * tn[1], c.b * tn[2]];
  g.setAttribute('color', m.transparent ? fill(4, [...rgb, m.opacity]) : fill(3, rgb));
  const rm = new Uint8Array(n * 4); // 8 bit reichen; 4 Byte wegen der Ausrichtung
  for (let i = 0; i < n; i++) rm.set([Math.round(m.roughness * 255), Math.round(m.metalness * 255)], i * 4);
  g.setAttribute('aRM', new THREE.BufferAttribute(rm, 4, true));
  const e = m.emissive, ei = m.emissiveIntensity ?? 1;
  g.setAttribute('aEm', fill(3, [e.r * ei, e.g * ei, e.b * ei]));
  if (!g.index) g.setIndex(Array.from({ length: n }, (_, i) => i)); // Index einheitlich (sonst ~3x so viele Vertices)
  return g;
}

/** Meshes -> { groups: [{ geoms, sources, material }], rest: [mesh] } */
export function unify(meshes) {
  const groups = new Map();
  const rest = [];
  for (const mesh of meshes) {
    const p = plan(mesh);
    if (!p) { rest.push(mesh); continue; }
    if (!groups.has(p.key)) groups.set(p.key, { p, geoms: [], sources: [], material: material(p, mesh.material) });
    const g = groups.get(p.key);
    g.geoms.push(bake(mesh, p));
    g.sources.push(mesh);
  }
  return { groups: [...groups.values()], rest };
}
