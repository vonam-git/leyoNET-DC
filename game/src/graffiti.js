import * as THREE from 'three';

// Plan v4 E: Wand-Sprueche im Graffiti-Stil mit dem gesprayten "ly" aus dem Favicon (vendor/leyonet/branding/favicon.svg).
// Alles prozedural und fest (gleicher Zufall bei jedem Start): eigene Strichschrift, Spraydose aus weichen Punkten, Sprenkel,
// Laufspuren. EIN Atlas + EIN Material = ein Draw Call. Struktur und Licht kommen von der Wand: Normal-/ORM-Map und Lightmap
// mit den UVs der Betonwand (Regel 2: Base Color + Normal + Roughness), nur die Farbe liegt auf eigenen UVs (Kanal 2).

/** Sprueche: Wand-Objekt im Raum-GLB, Mitte (Meter, glTF), Breite x Hoehe. Text frei aenderbar (A-Z, Ä Ö Ü, . , ! ? - '). */
const PIECES = [
  { name: 'ly', wall: 'wall_left', at: [1.52, -2.6], size: [1.2, 1.3], logo: true }, // am Ende des Kaltgangs
  { name: 'neustart', wall: 'wall_left', at: [1.55, -4.75], size: [2.1, 0.95], lines: ['HAST DU SCHON', 'NEU GESTARTET?'] },
  { name: 'dns', wall: 'wall_front', at: [1.62, 5.05], size: [1.7, 0.95], lines: ['ES IST IMMER', 'DNS.'] },
  { name: 'ping', wall: 'wall_right', at: [1.55, -5.1], size: [1.35, 0.95], lines: ['PING', 'ZUERST.'] },
  { name: 'backup', wall: 'wall_front', at: [1.55, 2.0], size: [2.5, 0.85], lines: ['KEIN BACKUP?', 'KEIN MITLEID.'] },
];
const SPACE = 3.2; // Wortabstand im Raster
const PX = 400; // Pixel pro Meter
const ATLAS = [2048, 1024];
const INK = [14, 14, 16];
const WHITE = [238, 238, 234];

// ---- Strichschrift (Raster 4 x 6, y nach oben; '~' = gerundet, sonst Ecken) ----
const GLYPHS = {
  A: ['0,0 2,6 4,0', '0.8,2 3.3,2.2'],
  B: ['0,0 0,6', '~0,6 2.6,5.8 2.9,4.4 1.8,3.2 0,3.1', '~0,3.1 2.6,3 3.6,1.6 2.4,0.2 0,0'],
  C: ['~3.6,5 2.4,6 0.7,5.2 0,3 0.7,0.8 2.4,0 3.7,0.9'],
  D: ['0,0 0,6', '~0,6 2.4,5.6 3.8,3.6 3.2,1.2 1.6,0.1 0,0'],
  E: ['3.4,6 0,6 0,0 3.5,0', '0,3.1 2.6,3.2'],
  F: ['3.4,6 0,6 0,0', '0,3.2 2.6,3.3'],
  G: ['~3.5,5.1 2.3,6 0.7,5.2 0,3 0.7,0.8 2.4,0 3.7,1', '3.7,0.9 3.7,2.8 2.1,2.8'],
  H: ['0,0 0,6', '3.6,0 3.6,6', '0,3 3.6,3.2'],
  I: ['0.4,0 0.4,6'],
  J: ['2.8,6 2.8,1.4', '~2.8,1.4 2.2,0.2 1,0 0,1'],
  K: ['0,0 0,6', '3.4,6 0.2,2.9 3.6,0'],
  L: ['0,6 0,0 3.2,0'],
  M: ['0,0 0.3,6 2.3,2.4 4.3,6 4.6,0'],
  N: ['0,0 0,6 3.6,0 3.6,6'],
  O: ['~2,6 0.6,5.2 0,3 0.6,0.8 2,0 3.4,0.8 4,3 3.4,5.2 2,6 1.2,5.8'],
  P: ['0,0 0,6', '~0,6 2.6,5.9 3.5,4.5 2.6,3 0,2.7'],
  Q: ['~2,6 0.6,5.2 0,3 0.6,0.8 2,0 3.4,0.8 4,3 3.4,5.2 2,6', '2.6,1.6 4.2,-0.4'],
  R: ['0,0 0,6', '~0,6 2.6,5.9 3.4,4.6 2.6,3.2 0,2.9', '1.4,2.9 3.8,0'],
  S: ['~3.3,5.2 2,6 0.5,5.4 0.4,4 1.8,3.1 3.2,2.1 3.1,0.7 1.6,0 0,0.8'],
  T: ['0,6 4,6', '2,6 2,0'],
  U: ['0,6 0,2', '~0,2 0.5,0.5 1.9,0 3.2,0.5 3.6,2', '3.6,2 3.6,6'],
  V: ['0,6 1.9,0 3.8,6'],
  W: ['0,6 1.2,0 2.5,4 3.8,0 5,6'],
  X: ['0,6 3.6,0', '3.6,6 0,0'],
  Y: ['0,6 1.9,3 3.8,6', '1.9,3 1.7,0'],
  Z: ['0,6 3.6,6 0,0 3.7,0'],
  '.': ['0.3,0.1 0.5,0.1'], ',': ['0.5,0.3 0.1,-0.9'], '!': ['0.4,6 0.4,2', '0.3,0.1 0.5,0.1'], '-': ['0,2.8 2,2.9'], "'": ['0.3,6.2 0.1,5'],
  '?': ['~0,5 0.8,6 2.4,5.9 3.1,4.6 2.2,3.2 1.5,2.6 1.5,1.8', '1.4,0.1 1.6,0.1'],
};
const DOTS = { Ä: 'A', Ö: 'O', Ü: 'U' };
const strokes = (ch) => {
  const list = (GLYPHS[DOTS[ch] ?? ch] ?? []).map((s) => {
    const round = s[0] === '~';
    return { round, pts: s.slice(round ? 1 : 0).split(' ').map((p) => p.split(',').map(Number)) };
  });
  if (DOTS[ch]) for (const x of [1.1, 2.7]) list.push({ round: false, pts: [[x, 7.1], [x + 0.15, 7.1]] });
  return list;
};
const glyphWidth = (ch) => Math.max(0.8, ...strokes(ch).flatMap((s) => s.pts.map((p) => p[0])));

/** fester Zufall (mulberry32) */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Spraydose ----
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
function dab(g, x, y, r, c, a, hard = 0.55) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, rgba(c, a));
  gr.addColorStop(hard, rgba(c, a * 0.85));
  gr.addColorStop(1, rgba(c, 0));
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}
/** Linienzug -> dicht liegende Punkte (Ecken gerade, '~' als CatmullRom), leicht zittrig */
function sample(pts, round, step) {
  const v = pts.map(([x, y]) => new THREE.Vector3(x, y, 0));
  const out = [];
  const add = (a, b) => {
    const n = Math.max(1, Math.ceil(a.distanceTo(b) / step));
    for (let i = 0; i < n; i++) out.push(a.clone().lerp(b, i / n));
  };
  if (round && v.length > 2) {
    const curve = new THREE.CatmullRomCurve3(v, false, 'centripetal');
    return curve.getSpacedPoints(Math.max(2, Math.ceil(curve.getLength() / step)));
  }
  for (let i = 1; i < v.length; i++) add(v[i - 1], v[i]);
  out.push(v.at(-1));
  return out;
}
function spray(g, pts, round, r, color, rand, { drips = 0, speckle = 1, alpha = 0.6, wobble = 0.12 } = {}) {
  const line = sample(pts, round, r * 0.22);
  let px = 0, py = 0;
  line.forEach((p, i) => {
    px += (rand() - 0.5) * r * wobble - px * 0.1;
    py += (rand() - 0.5) * r * wobble - py * 0.1;
    const end = Math.min(i, line.length - 1 - i) < 3; // Dose setzt an: Enden etwas fetter
    dab(g, p.x + px, p.y + py, r * (end ? 1.12 : 0.95 + rand() * 0.1), color, alpha);
    if (rand() < 0.4 * speckle) { // Sprenkel ausserhalb des Strahls
      const a = rand() * Math.PI * 2;
      const d = r * (1 + rand() * rand() * 1.6);
      g.fillStyle = rgba(color, 0.25 + rand() * 0.4);
      g.beginPath();
      g.arc(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 0.4 + rand() * r * 0.09, 0, 7);
      g.fill();
    }
  });
  for (let k = 0; k < drips; k++) { // Laufspuren: von unten liegenden Stellen senkrecht hinab, Tropfen am Ende
    const p = line[Math.floor(rand() * line.length)];
    const len = r * (2 + rand() * 6);
    const w = r * (0.13 + rand() * 0.1);
    for (let d = 0; d < len; d += w * 0.5) dab(g, p.x + Math.sin(d / 23) * w * 0.4, p.y + d, w * (1.15 - 0.35 * (d / len)), color, 0.75, 0.7);
    dab(g, p.x, p.y + len, w * 1.35, color, 0.9, 0.75);
  }
}

/** Textzeilen ins Rechteck (x, y, w, h in Pixeln): weisse Grundierung, schwarze Schrift, ein gesprayter Unterstrich */
function drawText(g, piece, x, y, w, h, rand) {
  const { lines } = piece;
  const gap = 1.1; // Buchstabenabstand im Raster
  const widths = lines.map((t) => [...t].reduce((s, ch) => s + (ch === ' ' ? SPACE : glyphWidth(ch) + gap), -gap));
  const pad = 26;
  // jede Zeile moeglichst breit, Hoehe begrenzt (kurze Zeilen werden gross: "DNS.")
  const avail = h - pad * 2 - 34;
  let units = widths.map((u) => Math.min((w - pad * 2) / u, (avail * 0.62) / 6));
  const total = units.reduce((s, u) => s + u * 6, 0) + 30 * (lines.length - 1);
  if (total > avail) units = units.map((u) => (u * (avail - 30 * (lines.length - 1))) / (total - 30 * (lines.length - 1)));
  const jobs = [];
  let cy = y + pad;
  lines.forEach((t, li) => {
    const u = units[li];
    let cx = x + (w - widths[li] * u) / 2;
    for (const ch of t) {
      if (ch === ' ') { cx += SPACE * u; continue; }
      const rot = (rand() - 0.5) * 0.09, dy = (rand() - 0.5) * u * 0.45, gw = glyphWidth(ch);
      for (const s of strokes(ch)) {
        const pts = s.pts.map(([a, b]) => {
          const ax = (a - gw / 2) * u, ay = (3 - b) * u; // um die Buchstabenmitte drehen, leicht kursiv
          return [cx + (gw * u) / 2 + ax * Math.cos(rot) - ay * Math.sin(rot) - ay * 0.1, cy + 3 * u + dy + ax * Math.sin(rot) + ay * Math.cos(rot)];
        });
        jobs.push({ pts, round: s.round, r: Math.max(5.5, u * 0.62) });
      }
      cx += (gw + gap) * u;
    }
    cy += u * 6 + 30;
  });
  for (const j of jobs) spray(g, j.pts, j.round, j.r * 1.9, WHITE, rand, { alpha: 0.16, speckle: 0.5 });
  for (const j of jobs) spray(g, j.pts, j.round, j.r, INK, rand, { drips: rand() < 0.22 ? 1 : 0 });
  const uy = Math.min(cy - 6, y + h - 30);
  spray(g, [[x + w * 0.16, uy + 5], [x + w * 0.5, uy - 4], [x + w * 0.86, uy + 2]], true, 5, INK, rand, { alpha: 0.45 });
}

/** "ly" wie im Favicon (Koordinaten 0..64): Netzwerk-l und -y mit Endknoten */
function drawLogo(g, x, y, w, h, rand) {
  const s = Math.min(w, h) / 60;
  const at = ([a, b]) => [x + w / 2 + (a - 33) * s, y + h / 2 + (b - 35) * s];
  const lines = [[[13, 13], [13, 43]], [[29, 25], [40, 39], [53, 25]], [[40, 39], [32, 53]]];
  const nodes = [[13, 13], [13, 43], [29, 25], [53, 25], [32, 53]];
  for (const l of lines) spray(g, l.map(at), false, s * 6.4, WHITE, rand, { alpha: 0.22 });
  for (const n of nodes) dab(g, ...at(n), s * 9.5, WHITE, 0.95, 0.6);
  for (const l of lines) spray(g, l.map(at), false, s * 2.5, INK, rand);
  for (const n of nodes) {
    const [cx, cy] = at(n);
    for (let k = 0; k < 5; k++) dab(g, cx + (rand() - 0.5) * s, cy + (rand() - 0.5) * s, s * 5.2, INK, 0.8, 0.72);
    spray(g, [[cx, cy], [cx + 0.5, cy]], false, s * 4.4, INK, rand, { drips: n[0] !== 29 && rand() < 0.75 ? 1 : 0, speckle: 3 }); // linker y-Knoten: Spur traefe den unteren Knoten
  }
}

function drawAtlas() {
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = ATLAS;
  const g = canvas.getContext('2d');
  const rects = [];
  let x = 0, y = 0, rowH = 0; // Regal-Packung, hohe Stuecke zuerst
  const order = PIECES.map((p, i) => i).sort((a, b) => PIECES[b].size[1] - PIECES[a].size[1]);
  for (const i of order) {
    const p = PIECES[i];
    const w = Math.round(p.size[0] * PX), h = Math.round(p.size[1] * PX);
    if (x + w > ATLAS[0]) { x = 0; y += rowH + 4; rowH = 0; }
    if (y + h > ATLAS[1]) throw new Error(`Graffiti: Atlas zu klein fuer ${p.name}`);
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip(); // Spritzer und Laufspuren bleiben im eigenen Feld
    const rand = rng(7 + i * 101);
    if (p.logo) drawLogo(g, x, y, w, h, rand);
    else drawText(g, p, x, y, w, h, rand);
    g.restore();
    rects[i] = { x, y, w, h };
    x += w + 4;
    rowH = Math.max(rowH, h);
  }
  return { canvas, rects };
}

/** Wandlage: Punkt (u nach rechts, v nach oben, vom Betrachter im Raum aus) -> Welt */
const FACES = {
  wall_left: { n: [1, 0, 0], u: [0, 0, -1], p: (c) => [0, c[0], c[1]] },
  wall_right: { n: [-1, 0, 0], u: [0, 0, 1], p: (c) => [8, c[0], c[1]] },
  wall_front: { n: [0, 0, -1], u: [-1, 0, 0], p: (c) => [c[1], c[0], 0] },
};

/** Sprueche auf die Waende legen (VOR batchRoom: laeuft dann als eigenes Material mit, Lichtschalter inklusive). */
export function addGraffiti(root, maxAnisotropy = 4) {
  root.updateMatrixWorld(true);
  const { canvas, rects } = drawAtlas();
  const tex = new THREE.CanvasTexture(canvas);
  tex.name = 'graffiti_atlas';
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, maxAnisotropy);
  tex.channel = 2; // eigene UVs; normal/ORM = Wand (uv), Lightmap = Wand (uv1)
  let material = null;
  const ray = new THREE.Raycaster();
  const made = [];
  PIECES.forEach((piece, i) => {
    const wall = root.getObjectByName(piece.wall);
    const face = FACES[piece.wall];
    if (!wall?.isMesh) { console.warn(`[graffiti] ${piece.name}: Wand ${piece.wall} fehlt`); return; }
    const src = wall.material;
    material ??= new THREE.MeshStandardMaterial({ name: 'graffiti', map: tex, normalMap: src.normalMap, roughnessMap: src.roughnessMap, roughness: src.roughness * 0.75, metalness: 0,
      lightMap: src.lightMap, lightMapIntensity: src.lightMapIntensity, envMapIntensity: src.envMapIntensity, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    if (src.normalScale) material.normalScale.copy(src.normalScale);
    const n = new THREE.Vector3(...face.n), u = new THREE.Vector3(...face.u), c = new THREE.Vector3(...face.p(piece.at));
    const [w, h] = piece.size;
    // Punkt der Wand (UV, Lightmap-UV) an der Stelle (du, dv)
    const probe = (du, dv) => {
      const from = c.clone().addScaledVector(u, du).addScaledVector(n, 0.3);
      from.y += dv;
      ray.set(from, n.clone().negate());
      ray.far = 0.6;
      return ray.intersectObject(wall, false)[0] ?? null;
    };
    const corners = [[-w / 2, h / 2], [w / 2, h / 2], [w / 2, -h / 2], [-w / 2, -h / 2]].map(([a, b]) => probe(a, b));
    const mid = probe(0, 0);
    if (corners.some((k) => !k?.uv1) || !mid?.uv1) { console.warn(`[graffiti] ${piece.name}: liegt nicht ganz auf der Wand`); return; }
    // Wand-UVs muessen ueber die Flaeche linear sein (keine Insel-Grenze), sonst waere das Licht verzerrt
    for (const k of ['uv', 'uv1']) {
      const avg = corners.reduce((s, q) => s.add(q[k]), new THREE.Vector2()).multiplyScalar(0.25);
      if (avg.distanceTo(mid[k]) > 0.01) { console.warn(`[graffiti] ${piece.name}: ${k} nicht linear`); return; }
    }
    const r = rects[i];
    const [aw, ah] = ATLAS;
    const uv2 = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]].flatMap(([a, b]) => [a / aw, 1 - b / ah]);
    const pos = corners.flatMap((k) => k.point.clone().addScaledVector(n, 0.002).toArray());
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 2, 3].flatMap(() => face.n), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(corners.flatMap((k) => k.uv.toArray()), 2));
    g.setAttribute('uv1', new THREE.Float32BufferAttribute(corners.flatMap((k) => k.uv1.toArray()), 2));
    g.setAttribute('uv2', new THREE.Float32BufferAttribute(uv2, 2));
    g.setIndex([0, 2, 1, 0, 3, 2]);
    const mesh = new THREE.Mesh(g, material);
    mesh.name = `graffiti_${piece.name}`;
    root.add(mesh);
    made.push(mesh);
  });
  return made;
}
