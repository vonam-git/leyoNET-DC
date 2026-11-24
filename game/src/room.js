import * as THREE from 'three';
import { deviceHulls } from './cables.js';

// Lightmap-Gruppen ohne brauchbaren Bake: dort KEINE Lightmap setzen (sonst schwarz) ->
// Fallback auf Echtzeit-Ambient. Leer seit ISSUE-002-Fix (Rack-Lightmap via Ebenen-Layout).
const SKIP_LIGHTMAP_GROUPS = new Set();

// Kollisionsrechtecke (XZ) werden aus den Bounding-Boxes dieser Objekte abgeleitet.
const WALL_T = 0.2;
const DOOR_GAP = 0.9; // Einhausung: Stirnseiten bleiben auf dieser Breite offen (Schiebetueren)

/**
 * Bereitet den geladenen Raum-GLB fuer das Spiel auf:
 * - Lightmap-Rekonstruktion nach bake.py: lightMap = aoMap (UV1), sRGB-dekodiert,
 *   lightMapIntensity = extras.lightmap_intensity * PI (three: Lambert = albedo / PI), aoMap = null
 * - Kollisions-Rechtecke (XZ) fuer Waende, Rack, Einhausung
 * - Mesh-Liste fuer die Kamera-Kollision
 */
export function prepareRoom(root) {
  const stats = { lightmapped: 0, skipped: 0 };
  const seen = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (seen.has(m)) continue;
      seen.add(m);
      const ex = m.userData || {};
      if (ex.lightmap_intensity === undefined || !m.aoMap) continue;
      if (SKIP_LIGHTMAP_GROUPS.has(ex.lightmap_group)) {
        m.aoMap = null;
        stats.skipped++;
      } else {
        m.lightMap = m.aoMap;
        m.lightMap.channel = ex.lightmap_texcoord ?? 1;
        // bake.py kodiert mit sRGB-Kurve (8 bit linear gab nur ~3 Stufen -> Banding)
        if (ex.lightmap_encoding === 'srgb') m.lightMap.colorSpace = THREE.SRGBColorSpace;
        m.lightMapIntensity = ex.lightmap_intensity * Math.PI;
        m.aoMap = null;
        stats.lightmapped++;
      }
      m.needsUpdate = true;
    }
  });

  const box = (name) => {
    const o = root.getObjectByName(name);
    return o ? new THREE.Box3().setFromObject(o) : null;
  };
  const rect = (x0, x1, z0, z1) => ({ x0, x1, z0, z1 });
  const colliders = [];

  // Raum-Innenmass aus dem Boden; Waende als duenne Rechtecke aussen herum.
  const floor = box('floor_tiles');
  const { min, max } = floor;
  colliders.push(
    rect(min.x - WALL_T, max.x + WALL_T, min.z - WALL_T, min.z), // hinten
    rect(min.x - WALL_T, min.x, min.z, max.z), // links
    rect(max.x, max.x + WALL_T, min.z, max.z), // rechts
    rect(min.x - WALL_T, max.x + WALL_T, max.z, max.z + WALL_T), // vorne (Tuer zu)
  );

  // Rack inkl. aller eingebauten Geraete (Szene ist geflacht: Prefix r1_ / rack_1)
  const rack = new THREE.Box3();
  root.traverse((o) => {
    if (o.isMesh && /^(rack_1|r1_)/.test(o.name)) rack.union(new THREE.Box3().setFromObject(o));
  });
  if (!rack.isEmpty()) colliders.push(rect(rack.min.x, rack.max.x, rack.min.z, rack.max.z));

  // Einhausung: Langseiten zu, Stirnseiten mit Tuer-Luecke in der Mitte
  const c = box('containment_frame');
  if (c) {
    const t = 0.05;
    const midX = (c.min.x + c.max.x) / 2;
    colliders.push(
      rect(c.min.x - t, c.min.x + t, c.min.z, c.max.z),
      rect(c.max.x - t, c.max.x + t, c.min.z, c.max.z),
    );
    for (const z of [c.min.z, c.max.z]) {
      colliders.push(
        rect(c.min.x, midX - DOOR_GAP / 2, z - t, z + t),
        rect(midX + DOOR_GAP / 2, c.max.x, z - t, z + t),
      );
    }
  }

  // Kamera-Kollision: Waende, Tuer, Rack, Einhausung - inkl. Glas (sonst rutscht die Kamera durchs
  // Tuer-Sichtfenster nach draussen). Mehrmaterial-Objekte sind im optimierten GLB Gruppen
  // (door -> door_1, door_2), daher alle Meshes UNTER dem Treffer sammeln.
  const cameraBlockers = new Set();
  for (const name of ['ceiling', 'wall_back', 'wall_left', 'wall_right', 'wall_front', 'door', 'door_glass',
    'rack_1', 'containment_frame', 'containment_glass', 'glass_front', 'glass_front_frame']) {
    root.getObjectByName(name)?.traverse((o) => o.isMesh && cameraBlockers.add(o));
  }

  // Arbeitstisch(e): Platte = Kollision (Spieler) + Kabel-Auflage; Notebooks liegen darauf
  const supports = [];
  root.traverse((o) => {
    if (o.userData.leyonet_desk_top === undefined) return;
    const top = new THREE.Box3().setFromObject(o, true);
    supports.push(top);
    colliders.push(rect(top.min.x, top.max.x, top.min.z, top.max.z));
  });
  const hulls = deviceHulls(root); // Kabel-Kollision (cables.js), vor dem Buendeln
  // Spawn 1 m vor der Rack-Front (Rack-Front zeigt nach +X), Blick auf das Rack (-X = yaw PI/2)
  const spawn = rack.isEmpty()
    ? new THREE.Vector3((min.x + max.x) / 2 + 1.2, 0, max.z - 1.4)
    : new THREE.Vector3(Math.min(rack.max.x + 1.0, max.x - 0.4), 0, (rack.min.z + rack.max.z) / 2);
  const spawnYaw = rack.isEmpty() ? 0 : Math.PI / 2;
  return { colliders, cameraBlockers: [...cameraBlockers], spawn, spawnYaw, bounds: floor, stats, hulls, supports };
}

/** Kreis (Radius r) gegen Rechtecke in XZ aufloesen - schiebt `pos` heraus, gleitet an Kanten. */
export function resolveCollisions(pos, r, colliders) {
  for (let pass = 0; pass < 2; pass++) {
    for (const c of colliders) {
      const cx = THREE.MathUtils.clamp(pos.x, c.x0, c.x1);
      const cz = THREE.MathUtils.clamp(pos.z, c.z0, c.z1);
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        pos.x += (dx / d) * (r - d);
        pos.z += (dz / d) * (r - d);
      } else {
        // Mittelpunkt im Rechteck: kuerzester Weg hinaus
        const push = [
          [c.x0 - r - pos.x, 0],
          [c.x1 + r - pos.x, 0],
          [0, c.z0 - r - pos.z],
          [0, c.z1 + r - pos.z],
        ].sort((a, b) => Math.hypot(...a) - Math.hypot(...b))[0];
        pos.x += push[0];
        pos.z += push[1];
      }
    }
  }
}
