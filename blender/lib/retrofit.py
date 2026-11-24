"""Devices-Retrofit (KONZEPT Kap. 3): detail geometry BAKED into textures.

Per device TYPE (e.g. switch_24) the detailed builder geometry ("high") is baked
once onto a simple low-poly housing ("low"), Cycles selected-to-active:
  - Albedo, Roughness, Metallic via EMIT (the high materials are temporarily
    rewired: emission = Base Color / Roughness / Metallic input) - a DIFFUSE colour
    bake would turn metal black
  - Normal (tangent space, OpenGL = glTF convention)
into one panel atlas per type: front face(s) v 0..0.75, rear face(s) v 0.75..1
(or front 0..1 without rear). Images are cached in assets/build/devices/ and keyed
by a hash of the high geometry, so all instances of a type share one material
and the bake only reruns when the builder geometry changes.

Overlays that the game addresses stay real geometry, as CHILD objects of the device:
  <device>_led_p<nn> / <device>_led_<func>   emissive quads (KONZEPT Kap. 3 Regel 2)
  <device>_port_<nn>                         port hotspot quads (raycast targets)
  <device>_display                           7-segment readouts (emissive)
They carry leyonet_overlay = "led" | "port" | "display" and are NOT lightmapped.
"""
import hashlib
import json
import zlib
from pathlib import Path

import bmesh
import bpy
import numpy as np

from . import materials

ROOT = Path(__file__).resolve().parents[2]
BUILD = ROOT / "assets" / "build" / "devices"
VERSION = 3               # 2: high bevelled before the bake; 3: transposed atlas UV fix
TEX_LONG = 1024                 # long side of a panel atlas ("Devices 1K", decision 2026-11-19)
TEX_LONG_PLAIN = 1024           # blanks, 1U PDU (kept separate in case the classes split again)
FRONT_FRAC = 0.75               # share of the short side for the front (with rear)
CAGE = 0.008                    # m: rays start this far in front of the low face
MAX_RAY = 0.05                  # m
MARGIN_PX = 4
BEVEL_W, BEVEL_SEG = 0.0005, 2  # Realismus-Regel 1 (devices)
OVERLAY_GAP = 0.0003            # m: overlay quads sit this far in front of the low face


# --- panel faces + atlas UV --------------------------------------------------------
def _panel_faces(obj, rear_y):
    """(front, rear) polygon indices: -Y faces at y <= 0 / +Y faces at y >= rear_y."""
    front, rear = [], []
    for p in obj.data.polygons:
        if p.normal.y < -0.99 and p.center.y <= 1e-4:
            front.append(p.index)
        elif rear_y is not None and p.normal.y > 0.99 and p.center.y >= rear_y - 1e-4:
            rear.append(p.index)
    return front, rear


def _bounds(obj, faces):
    me = obj.data
    co = np.array([me.vertices[v].co[:] for i in faces for v in me.polygons[i].vertices])
    return co[:, 0].min(), co[:, 0].max(), co[:, 2].min(), co[:, 2].max()


def atlas_size(front_bounds, has_rear, transpose, tex_long=TEX_LONG):
    x0, x1, z0, z1 = front_bounds
    w, h = x1 - x0, z1 - z0
    long_, short = (h, w) if transpose else (w, h)
    frac = FRONT_FRAC if has_rear else 1.0
    need = tex_long * short / long_ / frac
    s = 64
    while s < need:
        s *= 2
    return (s, tex_long) if transpose else (tex_long, s)   # (width px, height px)


def _assign_uv(obj, front, rear, fb, rb, transpose):
    """UV0 of the panel faces = atlas coordinates (other faces keep metres)."""
    me = obj.data
    uvl = me.uv_layers["UVMap"].data
    frac = FRONT_FRAC if rear else 1.0
    regions = [(front, fb, (0.0, frac))] + ([(rear, rb, (frac, 1.0))] if rear else [])
    for faces, (x0, x1, z0, z1), (v0, v1) in regions:
        for pi in faces:
            for li in me.polygons[pi].loop_indices:
                co = me.vertices[me.loops[li].vertex_index].co
                a = (co.x - x0) / (x1 - x0)          # 0..1 across the panel
                b = (co.z - z0) / (z1 - z0)          # 0..1 up the panel
                if faces is rear:
                    a = 1.0 - a                      # seen from behind
                # transpose only makes the ATLAS tall (atlas_size); the mapping stays
                # u = across, v = up/along - swapping here put the 1.7 m length of
                # pdu_0u onto the 64 px side (26 mm per pixel, fixed in VERSION 3)
                uvl[li].uv = (a, v0 + b * (v1 - v0))


# --- baking --------------------------------------------------------------------------
def _geom_hash(mb, extra):
    h = hashlib.sha1()
    co = np.array([v.co[:] for v in mb.bm.verts], dtype=np.float32).round(6)
    h.update(co.tobytes())
    h.update(json.dumps([mb.mats, [f.material_index for f in mb.bm.faces], extra, VERSION]).encode())
    return h.hexdigest()[:16]


def _paths(type_key):
    p = {k: BUILD / f"{type_key}_{k}.png" for k in ("color", "normal", "orm")}
    p["orm_base"] = BUILD / f"{type_key}_orm_base.png"      # bake result before the wear pass
    return p


# --- wear decals (Realismus-Regel 4) -------------------------------------------------------
# Dezente Gebrauchsspuren als ROUGHNESS-Variation im Panel-ORM, max. 3 pro Geraetetyp.
# Rechteck in Panel-Koordinaten der Front: a = 0..1 ueber die Breite (von links, von vorn
# gesehen), b = 0..1 von unten nach oben (pdu_0u: b laeuft entlang der 1.7 m Laenge).
#   src: (ambientCG-Set, Map), scale: Meter pro Wiederholung der Quellmap,
#   k: Rauheits-Delta (Roughness-Map: k * Abweichung vom Mittel; Opacity-Maske: k * Maske)
# Fingerabdruecke machen Pulverlack/Kunststoff GLATTER (k < 0), Staub/Kratzer RAUER (k > 0).
WEAR_MAX = 3
WEAR_CAP = 0.12           # |Rauheits-Delta| nie groesser ("nie uebertrieben")
FINGER = ("Fingerprints002", "Roughness")
SCUFF = ("SurfaceImperfections015", "Opacity")
WEAR = {
    "coreswitch_24": [dict(src=FINGER, rect=(0.00, 0.07, 0.15, 0.95), scale=0.12, k=-0.5),
                      dict(src=FINGER, rect=(0.05, 0.16, 0.05, 0.60), scale=0.12, k=-0.4),
                      dict(src=SCUFF, rect=(0.15, 0.62, 0.78, 1.00), scale=0.25, k=0.06)],
    "switch_24":     [dict(src=FINGER, rect=(0.00, 0.07, 0.15, 0.95), scale=0.12, k=-0.5),   # linkes Ohr
                      dict(src=FINGER, rect=(0.05, 0.16, 0.05, 0.60), scale=0.12, k=-0.4),   # Konsole
                      dict(src=SCUFF, rect=(0.15, 0.62, 0.78, 1.00), scale=0.25, k=0.06)],   # Oberkante
    # Router/Firewall: gleicher Bedienbereich wie der Switch (Ohr, Konsole links, Oberkante)
    "router_1u":     [dict(src=FINGER, rect=(0.00, 0.07, 0.15, 0.95), scale=0.12, k=-0.5),
                      dict(src=FINGER, rect=(0.05, 0.16, 0.05, 0.60), scale=0.12, k=-0.4),
                      dict(src=SCUFF, rect=(0.20, 0.70, 0.78, 1.00), scale=0.25, k=0.06)],
    "firewall_1u":   [dict(src=FINGER, rect=(0.00, 0.07, 0.15, 0.95), scale=0.12, k=-0.5),
                      dict(src=FINGER, rect=(0.05, 0.16, 0.05, 0.60), scale=0.12, k=-0.4),
                      dict(src=SCUFF, rect=(0.20, 0.70, 0.78, 1.00), scale=0.25, k=0.06)],
    "kvm_1u":        [dict(src=FINGER, rect=(0.00, 0.10, 0.10, 0.95), scale=0.12, k=-0.5),   # Griffe
                      dict(src=FINGER, rect=(0.90, 1.00, 0.10, 0.95), scale=0.12, k=-0.5),
                      dict(src=FINGER, rect=(0.35, 0.65, 0.05, 0.50), scale=0.12, k=-0.4)],  # Griffmulde
    "server_1u":     [dict(src=FINGER, rect=(0.00, 0.08, 0.10, 0.95), scale=0.12, k=-0.5),   # Griff links
                      dict(src=FINGER, rect=(0.92, 1.00, 0.10, 0.95), scale=0.12, k=-0.5),   # Griff rechts
                      dict(src=SCUFF, rect=(0.10, 0.90, 0.00, 1.00), scale=0.30, k=0.05)],   # Bezel
    "patchpanel_24": [dict(src=FINGER, rect=(0.22, 0.55, 0.10, 0.75), scale=0.15, k=-0.45),  # Patch-Feld
                      dict(src=SCUFF, rect=(0.05, 0.95, 0.70, 1.00), scale=0.25, k=0.06)],   # Label-Leiste
    "pdu_1u":        [dict(src=FINGER, rect=(0.02, 0.12, 0.10, 0.90), scale=0.10, k=-0.5)],  # Schalter
    "desk_strip":    [dict(src=FINGER, rect=(0.02, 0.14, 0.10, 0.95), scale=0.10, k=-0.5),   # Schalter
                      dict(src=SCUFF, rect=(0.15, 1.00, 0.00, 1.00), scale=0.25, k=0.05)],
    "table_outlet":  [dict(src=FINGER, rect=(0.05, 0.95, 0.05, 0.60), scale=0.12, k=-0.4)],   # Patch-Feld
    "pdu_0u":        [dict(src=FINGER, rect=(0.00, 1.00, 0.86, 0.97), scale=0.10, k=-0.45),  # Breaker
                      dict(src=SCUFF, rect=(0.00, 1.00, 0.05, 0.80), scale=0.40, k=0.05)],   # Dosenfeld
    "blank":         [dict(src=SCUFF, rect=(0.00, 1.00, 0.00, 1.00), scale=0.30, k=0.05)],   # Staub/Kratzer
}


def wear_spec(type_key):
    for prefix, spec in WEAR.items():
        if type_key.startswith(prefix):
            if len(spec) > WEAR_MAX:
                raise ValueError(f"{type_key}: {len(spec)} wear decals > {WEAR_MAX} (Regel 4)")
            return spec
    return []


def _src_map(asset, kind):
    from . import textures
    img = bpy.data.images.load(str(textures._map(asset, kind)), check_existing=False)
    img.colorspace_settings.name = "Non-Color"
    a = _px(img)[..., 0].copy()
    bpy.data.images.remove(img)
    return a


def _soft_rect(h, w, feather):
    """1 inside, smooth falloff over `feather` (fraction of the short side) at the edges."""
    y = np.linspace(0, 1, h)[:, None]
    x = np.linspace(0, 1, w)[None, :]
    f = max(feather, 1e-3)
    ex = np.clip(np.minimum(x, 1 - x) * w / (min(h, w) * f), 0, 1)
    ey = np.clip(np.minimum(y, 1 - y) * h / (min(h, w) * f), 0, 1)
    m = np.minimum(ex, ey)
    return m * m * (3 - 2 * m)                       # smoothstep


def apply_wear(type_key, paths, size, fb, transpose, has_rear):
    """orm_base -> orm with the wear decals of `type_key` (roughness channel only).
    Returns stats per decal (mean / max |delta| in its region)."""
    spec = wear_spec(type_key)
    img = bpy.data.images.load(str(paths["orm_base"]), check_existing=False)
    img.colorspace_settings.name = "Non-Color"
    orm = _px(img).copy()
    bpy.data.images.remove(img)
    h, w = orm.shape[:2]
    frac = FRONT_FRAC if has_rear else 1.0
    pw, ph = fb[1] - fb[0], fb[3] - fb[2]              # panel size in metres (across, up)
    delta = np.zeros((h, w), dtype=np.float32)
    stats = []
    cache = {}
    for d in spec:
        a0, a1, b0, b1 = d["rect"]
        # atlas pixel rectangle of the decal (front region): u = a, v = b * frac
        # (also for tall/transposed atlases, see _assign_uv)
        x0, x1, y0, y1 = a0 * w, a1 * w, b0 * frac * h, b1 * frac * h
        mx, my = pw, ph                                # metres along x / y of the atlas
        ix0, ix1, iy0, iy1 = int(x0), max(int(x0) + 1, int(round(x1))), int(y0), max(int(y0) + 1, int(round(y1)))
        rh, rw = iy1 - iy0, ix1 - ix0
        if d["src"] not in cache:
            cache[d["src"]] = _src_map(*d["src"])
        src = cache[d["src"]]
        sh, sw = src.shape
        # sample the source map in metres: 1 repetition = d["scale"] m, seeded offset per decal
        off = (zlib.crc32(f"{type_key}{d['rect']}".encode()) % 997) / 997.0   # reproducible
        xs = ((np.arange(ix0, ix1) + 0.5) / w * mx / d["scale"] + off) % 1.0
        ys = ((np.arange(iy0, iy1) + 0.5) / (frac * h) * my / d["scale"] + off) % 1.0
        patch = src[(ys * sh).astype(int)[:, None], (xs * sw).astype(int)[None, :]]
        val = patch - patch.mean() if d["src"][1] == "Roughness" else patch
        dd = np.clip(d["k"] * val, -WEAR_CAP, WEAR_CAP) * _soft_rect(rh, rw, 0.35)
        delta[iy0:iy1, ix0:ix1] += dd
        stats.append({"src": d["src"][0], "rect": d["rect"], "mean": round(float(dd.mean()), 4),
                      "max_abs": round(float(np.abs(dd).max()), 4)})
    delta = np.clip(delta, -WEAR_CAP, WEAR_CAP)
    orm[..., 1] = np.clip(orm[..., 1] + delta, 0.02, 1.0)
    out = bpy.data.images.new(f"{type_key}_orm_wear", w, h, alpha=False)
    out.colorspace_settings.name = "Non-Color"
    out.pixels.foreach_set(orm.ravel())
    _save(out, paths["orm"])
    return stats


def _rewire(mats, socket):
    """Material output <- Emission(<Principled input `socket`>). Returns restore list."""
    restore = []
    for m in mats:
        nt = m.node_tree
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output), None)
        if bsdf is None or out is None:
            continue
        old = out.inputs["Surface"].links[0].from_socket if out.inputs["Surface"].is_linked else None
        em = nt.nodes.new("ShaderNodeEmission")
        em.inputs["Strength"].default_value = 1.0
        inp = bsdf.inputs[socket]
        if inp.is_linked:
            src = inp.links[0].from_socket
            if src.type == "VALUE":                   # float -> grey via RGB combine
                comb = nt.nodes.new("ShaderNodeCombineColor")
                for k in ("Red", "Green", "Blue"):
                    nt.links.new(src, comb.inputs[k])
                nt.links.new(comb.outputs["Color"], em.inputs["Color"])
                restore.append((m, old, [em, comb]))
            else:
                nt.links.new(src, em.inputs["Color"])
                restore.append((m, old, [em]))
        else:
            v = inp.default_value
            em.inputs["Color"].default_value = (*v[:3], 1.0) if hasattr(v, "__len__") else (v, v, v, 1.0)
            restore.append((m, old, [em]))
        nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return restore


def _unwire(restore):
    for m, old, nodes in restore:
        nt = m.node_tree
        out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output)
        for n in nodes:
            nt.nodes.remove(n)
        if old is not None:
            nt.links.new(old, out.inputs["Surface"])


def _bake(kind, high, proxy, img):
    proxy.data.materials[0].node_tree.nodes["BAKE_TARGET"].image = img
    vl = bpy.context.view_layer
    for o in vl.objects:
        o.select_set(False)
    high.select_set(True)
    proxy.select_set(True)
    vl.objects.active = proxy
    bk = bpy.context.scene.render.bake
    bk.use_selected_to_active = True
    bk.cage_extrusion = CAGE
    bk.max_ray_distance = MAX_RAY
    bk.margin = MARGIN_PX
    bk.margin_type = "EXTEND"
    bk.use_clear = True
    bk.target = "IMAGE_TEXTURES"
    if kind == "NORMAL":
        bk.normal_space = "TANGENT"
        bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT")
    else:
        bpy.ops.object.bake(type="EMIT")
    bk.use_selected_to_active = False


def _px(img):
    a = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(img.size[1], img.size[0], 4)


def bake_panel(type_key, high, low, front, rear, size):
    """Bake the high object onto the panel faces of `low` -> 3 PNG paths + stats."""
    sc = bpy.context.scene
    prev = (sc.render.engine, sc.cycles.samples)
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 8
    # proxy = panel faces only, one material with the bake target node
    proxy = low.copy()
    proxy.data = low.data.copy()
    proxy.name = f"{type_key}__bake_proxy"
    proxy.modifiers.clear()
    bpy.context.scene.collection.objects.link(proxy)
    bm = bmesh.new()
    bm.from_mesh(proxy.data)
    keep = set(front) | set(rear)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep], context="FACES")
    bm.to_mesh(proxy.data)
    bm.free()
    tmp = bpy.data.materials.new(f"{type_key}__bake_tmp")
    tmp.use_nodes = True
    tn = tmp.node_tree.nodes.new("ShaderNodeTexImage")
    tn.name = "BAKE_TARGET"
    tmp.node_tree.nodes.active = tn
    proxy.data.materials.clear()
    proxy.data.materials.append(tmp)
    for p in proxy.data.polygons:
        p.material_index = 0

    w, h = size
    imgs = {k: bpy.data.images.new(f"{type_key}_{k}_bake", w, h, alpha=False, float_buffer=True)
            for k in ("color", "rough", "metal", "normal")}
    for k in ("rough", "metal", "normal"):
        imgs[k].colorspace_settings.name = "Non-Color"
    hmats = [s.material for s in high.material_slots if s.material]
    for key, sock in (("color", "Base Color"), ("rough", "Roughness"), ("metal", "Metallic")):
        restore = _rewire(hmats, sock)
        try:
            _bake("EMIT", high, proxy, imgs[key])
        finally:
            _unwire(restore)
    _bake("NORMAL", high, proxy, imgs["normal"])

    BUILD.mkdir(parents=True, exist_ok=True)
    paths = _paths(type_key)
    col = _px(imgs["color"])
    out = bpy.data.images.new(f"{type_key}_color", w, h, alpha=False)
    out.colorspace_settings.name = "sRGB"
    lin = np.clip(col[..., :3], 0, 1)
    srgb = np.where(lin <= 0.0031308, 12.92 * lin, 1.055 * np.power(lin, 1 / 2.4) - 0.055)
    col[..., :3] = srgb
    col[..., 3] = 1
    out.pixels.foreach_set(col.ravel())
    _save(out, paths["color"])
    orm = np.ones((h, w, 4), dtype=np.float32)
    orm[..., 1] = np.clip(_px(imgs["rough"])[..., 0], 0.02, 1.0)
    orm[..., 2] = np.clip(_px(imgs["metal"])[..., 0], 0.0, 1.0)
    out = bpy.data.images.new(f"{type_key}_orm", w, h, alpha=False)
    out.colorspace_settings.name = "Non-Color"
    out.pixels.foreach_set(orm.ravel())
    _save(out, paths["orm_base"])
    nrm = _px(imgs["normal"])
    nrm[..., 3] = 1
    out = bpy.data.images.new(f"{type_key}_normal", w, h, alpha=False)
    out.colorspace_settings.name = "Non-Color"
    out.pixels.foreach_set(nrm.ravel())
    _save(out, paths["normal"])

    stats = {"size": [w, h], "albedo_mean": float(lin.mean()),
             "rough_mean": float(orm[..., 1].mean()), "metal_mean": float(orm[..., 2].mean()),
             "normal_flat_frac": float((np.abs(nrm[..., 2] - 1.0) < 0.02).mean())}
    for img in imgs.values():
        bpy.data.images.remove(img)
    bpy.data.objects.remove(proxy)
    bpy.data.materials.remove(tmp)
    sc.render.engine, sc.cycles.samples = prev
    return paths, stats


def _save(img, path):
    img.filepath_raw = str(path)
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def panel_material(type_key, paths, size):
    name = f"{type_key}_panel"
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    uv = nt.nodes.new("ShaderNodeUVMap")
    uv.uv_map = "UVMap"

    def tex(path, cs):
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = bpy.data.images.load(str(path), check_existing=True)
        t.image.colorspace_settings.name = cs
        t.interpolation = "Linear"
        t.extension = "EXTEND"
        nt.links.new(uv.outputs["UV"], t.inputs["Vector"])
        return t

    nt.links.new(tex(paths["color"], "sRGB").outputs["Color"], bsdf.inputs["Base Color"])
    orm = tex(paths["orm"], "Non-Color")
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(orm.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nm.uv_map = "UVMap"
    nt.links.new(tex(paths["normal"], "Non-Color").outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    mat["texset"] = {"source": "baked from ambientCG CC0 sets (lib.retrofit)", "type": type_key,
                     "size": list(size), "maps": "color+normal+orm"}
    return mat


# --- overlays ---------------------------------------------------------------------------
def _quad_obj(name, x0, x1, z0, z1, y, facing, mat_name, parent, overlay, props=None):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in ((x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1))]
    f = bm.faces.new(vs if facing < 0 else list(reversed(vs)))
    f.normal_update()
    uvl = bm.loops.layers.uv.new("UVMap")
    for loop, uvc in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uvl].uv = uvc
    bm.to_mesh(me)
    bm.free()
    me.materials.append(materials.get(mat_name))
    o = bpy.data.objects.new(name, me)
    parent.users_collection[0].objects.link(o)
    o.parent = parent
    o["leyonet_overlay"] = overlay
    for k, v in (props or {}).items():
        o[k] = v
    return o


def add_overlays(dev, mb):
    """LED / port / display child objects from the specs recorded on the MeshBuilder."""
    out = []
    for lid, x0, x1, z0, z1, y, facing, mat, state in mb.leds:
        out.append(_quad_obj(f"{dev.name}_led_{lid}", x0, x1, z0, z1, y + facing * OVERLAY_GAP,
                             facing, mat, dev, "led", {"leyonet_led_state": state}))
    for pid, kind, x0, x1, z0, z1, y, facing, label in mb.ports:
        props = {"leyonet_port": pid, "leyonet_port_kind": kind}
        if label:
            props["leyonet_port_label"] = label
        out.append(_quad_obj(f"{dev.name}_port_{pid}", x0, x1, z0, z1, y + facing * OVERLAY_GAP,
                             facing, "port_black", dev, "port", props))
    for kind, x0, x1, z0, z1, y in mb.hotspots:
        out.append(_quad_obj(f"{dev.name}_{kind}", x0, x1, z0, z1, y - OVERLAY_GAP, -1, "hotspot", dev, kind))
    if mb.display:
        me = bpy.data.meshes.new(f"{dev.name}_display")
        bm = bmesh.new()
        for x0, x1, z0, z1, y in mb.display:
            y -= OVERLAY_GAP
            bm.faces.new([bm.verts.new(p) for p in ((x0, y, z0), (x0, y, z1), (x1, y, z1), (x1, y, z0))])
        bm.normal_update()
        for f in bm.faces:
            if f.normal.y > 0:
                f.normal_flip()
        bm.to_mesh(me)
        bm.free()
        me.materials.append(materials.get("display_seg"))
        o = bpy.data.objects.new(f"{dev.name}_display", me)
        dev.users_collection[0].objects.link(o)
        o.parent = dev
        o["leyonet_overlay"] = "display"
        out.append(o)
    return out


def is_overlay(obj):
    return "leyonet_overlay" in obj


# --- main entry ---------------------------------------------------------------------------
def finish_device(type_key, high_mb, low_mb, kind, he, depth, collection=None,
                  rear_y=None, transpose=False, tex_long=TEX_LONG):
    """Bake (or reuse) the panel textures of `type_key`, return the low-poly device
    object with bevel modifier and overlay children. high_mb / low_mb: MeshBuilders;
    LED / port / display specs are read from high_mb."""
    low = low_mb.finish(kind, he=he, depth=depth, collection=collection)
    front, rear = _panel_faces(low, rear_y)
    if not front:
        raise RuntimeError(f"{type_key}: low-poly has no front panel face")
    fb = _bounds(low, front)
    rb = _bounds(low, rear) if rear else None
    size = atlas_size(fb, bool(rear), transpose, tex_long)
    _assign_uv(low, front, rear, fb, rb, transpose)

    key = _geom_hash(high_mb, [fb, rb, size, transpose])
    paths = _paths(type_key)
    meta = BUILD / f"{type_key}.json"
    info = json.loads(meta.read_text()) if meta.exists() else {}
    cached = info.get("hash") == key and all(paths[k].exists() for k in ("color", "normal", "orm_base"))
    if cached:
        high_mb.bm.free()
        stats = info["stats"]
    else:
        high = high_mb.finish(kind, he=he, depth=depth, collection=collection)
        high.name = f"{type_key}__high"
        hb = high.modifiers.new("Bevel", "BEVEL")          # Realismus-Regel 1 on the details:
        hb.width, hb.segments = BEVEL_W, BEVEL_SEG         # the edges are what the normal
        hb.limit_method = "ANGLE"                          # map carries (box details are flat
        hb.angle_limit = 0.5236                            # seen from the front)
        hb.use_clamp_overlap = True
        bpy.context.view_layer.update()
        paths, stats = bake_panel(type_key, high, low, front, rear, size)
        bpy.data.objects.remove(high)
        info = {"hash": key, "stats": stats, "type": type_key}
        print(f"[retrofit] baked {type_key} {size}: {stats}")
    wkey = hashlib.sha1(json.dumps([wear_spec(type_key), WEAR_CAP, key]).encode()).hexdigest()[:16]
    if info.get("wear_hash") != wkey or not paths["orm"].exists():
        info["wear"] = apply_wear(type_key, paths, size, fb, transpose, bool(rear))
        info["wear_hash"] = wkey
        print(f"[retrofit] wear {type_key}: {info['wear']}")
    meta.write_text(json.dumps(info, indent=1))

    mat = panel_material(type_key, paths, size)
    low.data.materials.append(mat)
    mi = len(low.data.materials) - 1
    for pi in front + rear:
        low.data.polygons[pi].material_index = mi
    m = low.modifiers.new("Bevel", "BEVEL")
    m.width, m.segments = BEVEL_W, BEVEL_SEG
    m.limit_method = "ANGLE"
    m.angle_limit = 0.5236
    m.use_clamp_overlap = True
    m.harden_normals = False
    low["leyonet_type"] = type_key
    add_overlays(low, high_mb)
    return low
