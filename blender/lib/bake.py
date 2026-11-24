"""Bake + export pipeline (the ONLY export path, see CLAUDE.md).

1. bake_procedural_textures(): procedural materials -> tiling PNGs
   (base colour sRGB, roughness, tangent normal); texture_material() rewires
   the material to base colour + normal images (UV0 'UVMap'); roughness becomes
   the constant mean of the roughness map (avoids ORM packing with the lightmap).
2. unwrap_lightmap() + bake_lightmap(): non-overlapping UV1 'Lightmap' per
   bake group, Cycles DIFFUSE direct+indirect (irradiance, no albedo), OIDN
   denoise, encoded to 8-bit PNG with a per-group scale and the sRGB transfer
   curve (linear 8 bit left most of the room on ~3 levels -> banding, ISSUE-001).
3. export_glb(): per-group material copies, Blender glTF export WITHOUT the
   lightmap, then inject_lightmaps() writes each group's lightmap PNG into the
   GLB as its own texture and sets it as occlusionTexture {texCoord: 1}.
   (Done as a post-step because the Blender exporter packs occlusion + roughness
   maps into one ORM image although they live on different UV sets.)
   Material extras: {lightmap_intensity, lightmap_texcoord: 1, lightmap_group}.
   Writes assets/out/<name>.raw.glb; afterwards run gltf-transform (OPTIMIZE_CMD,
   Run C: 3 steps - optimize WITHOUT Draco and texture compression and
   without join/palette/instance (keeps `<geraet>_led_p<nn>` nodes + own LED
   materials), then UASTC for normal maps only, ETC1S for every other slot, Draco last).

Lightmap reconstruction in an engine:
  irradiance = srgb_to_linear(occlusionTex.rgb) * extras.lightmap_intensity   (extras.lightmap_encoding "srgb")
(three.js: material.lightMap = material.aoMap; lightMap.channel = 1; lightMap.colorSpace = SRGBColorSpace;
 lightMapIntensity = extras.lightmap_intensity * PI (Lambert = albedo / PI); aoMap = null).
"""
import json
import math
import struct
from pathlib import Path

import bpy
import numpy as np

from . import uvtools

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "assets" / "out"
BUILD_DIR = ROOT / "assets" / "build"
LM_UV = "Lightmap"
OPTIMIZE_CMD = (
    "npx gltf-transform optimize {src} {tmp} --compress false --texture-compress false"
    " --join false --palette false --instance false"
    " && nice -n 19 npx gltf-transform uastc {tmp} {tmp} --slots normalTexture"
    " --level 2 --zstd 18 --jobs 2"   # no RDO: gltf-transform skips it for normals
    " && nice -n 19 npx gltf-transform etc1s {tmp} {tmp} --slots '!normalTexture' --jobs 2"
    " && npx gltf-transform draco {tmp} {dst}"      # last: uastc/etc1s would decode Draco again
    " && rm {tmp}"
)


# --- helpers -----------------------------------------------------------------
def _bsdf(mat):
    return next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")


def _output(mat):
    outs = [n for n in mat.node_tree.nodes if n.type == "OUTPUT_MATERIAL"]
    return next((n for n in outs if n.is_active_output), outs[0])


def _select(objs):
    vl = bpy.context.view_layer
    for o in vl.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    vl.objects.active = objs[0]


def _cycles(samples):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    bk = sc.render.bake
    bk.target = "IMAGE_TEXTURES"
    bk.margin = BAKE_MARGIN_PX
    bk.margin_type = "EXTEND"
    bk.use_clear = True


def _save_png(img, path, colorspace=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    if colorspace:
        img.colorspace_settings.name = colorspace
    img.filepath_raw = str(path)
    img.file_format = "PNG"
    img.save()
    return path


def _pixels(img):
    a = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(-1, 4)


def _uv_node(nt, uv_name, img, colorspace):
    uvn = nt.nodes.new("ShaderNodeUVMap")
    uvn.uv_map = uv_name
    tn = nt.nodes.new("ShaderNodeTexImage")
    tn.image = img
    img.colorspace_settings.name = colorspace
    nt.links.new(uvn.outputs["UV"], tn.inputs["Vector"])
    return tn


# --- 1. procedural -> textures -------------------------------------------------
def bake_procedural_textures(mat, out_dir, samples=16):
    """Bake a procedural material (mat['leyonet_bake']) to base/rough/normal PNGs
    on a 1x1 UV plane. Returns {channel: image}."""
    info = dict(mat["leyonet_bake"])
    res = int(info["res"])
    _cycles(samples)
    me = bpy.data.meshes.new("_bake_plane")
    me.from_pydata([(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)], [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new(name="UVMap")
    for li, co in zip(range(4), ((0, 0), (1, 0), (1, 1), (0, 1))):
        uv.data[li].uv = co
    me.materials.append(mat)
    ob = bpy.data.objects.new("_bake_plane", me)
    bpy.context.scene.collection.objects.link(ob)

    nt = mat.node_tree
    bsdf, out = _bsdf(mat), _output(mat)
    target = nt.nodes.new("ShaderNodeTexImage")
    nt.nodes.active = target
    imgs = {}
    _select([ob])
    for chan, sock, cs in (("base", "Base Color", "sRGB"), ("rough", "Roughness", "Non-Color")):
        img = bpy.data.images.new(f"{mat.name}_{chan}", res, res, alpha=False)
        img.colorspace_settings.name = cs
        target.image = img
        em = nt.nodes.new("ShaderNodeEmission")
        nt.links.new(bsdf.inputs[sock].links[0].from_socket, em.inputs["Color"])
        nt.links.new(em.outputs[0], out.inputs["Surface"])
        bpy.ops.object.bake(type="EMIT", margin=0, use_clear=True)
        nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
        nt.nodes.remove(em)
        imgs[chan] = img
    img = bpy.data.images.new(f"{mat.name}_normal", res, res, alpha=False)
    img.colorspace_settings.name = "Non-Color"
    target.image = img
    bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT", margin=0, use_clear=True)
    imgs["normal"] = img

    nt.nodes.remove(target)
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    for chan, img in imgs.items():
        _save_png(img, Path(out_dir) / f"{mat.name}_{chan}.png")
    print(f"[bake] textures {mat.name}: {res}px -> {out_dir}")
    return imgs


def texture_material(mat, imgs):
    """Replace the procedural graph of `mat` by its baked images (UV0)."""
    nt = mat.node_tree
    bsdf, out = _bsdf(mat), _output(mat)
    for n in list(nt.nodes):
        if n not in (bsdf, out):
            nt.nodes.remove(n)
    base = _uv_node(nt, "UVMap", imgs["base"], "sRGB")
    nt.links.new(base.outputs["Color"], bsdf.inputs["Base Color"])
    # Roughness as a constant (mean of the baked map): a roughness TEXTURE would be
    # packed by the glTF exporter into one ORM image together with the lightmap
    # (occlusion R, roughness G) although they live on different UV sets.
    rough_mean = float(_pixels(imgs["rough"])[:, 1].mean())
    bsdf.inputs["Roughness"].default_value = rough_mean
    mat["roughness_mean"] = rough_mean
    nrm = _uv_node(nt, "UVMap", imgs["normal"], "Non-Color")
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nm.uv_map = "UVMap"
    nt.links.new(nrm.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    del mat["leyonet_bake"]
    mat["leyonet_textures"] = True


def bake_all_procedural(objs, out_dir):
    mats = {s.material for o in objs for s in o.material_slots
            if s.material is not None and "leyonet_bake" in s.material}
    for m in sorted(mats, key=lambda m: m.name):
        texture_material(m, bake_procedural_textures(m, out_dir))
    return mats


# --- 2. lightmaps --------------------------------------------------------------
BAKE_MARGIN_PX = 3


def _normalize_uv(objs, layer):
    """Map `layer` of all `objs` jointly into 0..1 (uniform scale, keeps proportions)."""
    uvs = []
    for o in objs:
        a = np.empty(len(o.data.loops) * 2, dtype=np.float32)
        o.data.uv_layers[layer].data.foreach_get("uv", a)
        uvs.append(a.reshape(-1, 2))
    allp = np.concatenate(uvs)
    lo, ext = allp.min(0), float((allp.max(0) - allp.min(0)).max()) or 1.0
    for o, a in zip(objs, uvs):
        o.data.uv_layers[layer].data.foreach_set("uv", ((a - lo) / ext).ravel())


def check_lightmap_uv(objs, layer=LM_UV):
    """Raise if any object's lightmap UV leaves 0..1 (nothing would be baked there)."""
    bad = []
    for o in objs:
        a = np.empty(len(o.data.loops) * 2, dtype=np.float32)
        o.data.uv_layers[layer].data.foreach_get("uv", a)
        if a.size and (a.min() < -1e-4 or a.max() > 1 + 1e-4):
            bad.append(f"{o.name} [{a.min():.3f}, {a.max():.3f}]")
    if bad:
        raise RuntimeError(f"lightmap UV outside 0..1: {bad[:8]}")


def _uv_area(objs, layer=LM_UV):
    area = 0.0
    for o in objs:
        me = o.data
        a = np.empty(len(me.loops) * 2, dtype=np.float32)
        me.uv_layers[layer].data.foreach_get("uv", a)
        a = a.reshape(-1, 2)
        for p in me.polygons:
            q = a[p.loop_start:p.loop_start + p.loop_total]
            area += 0.5 * abs(float(np.dot(q[:, 0], np.roll(q[:, 1], 1)) - np.dot(q[:, 1], np.roll(q[:, 0], 1))))
    return area


def unwrap_lightmap(objs, res=1024, method="auto"):
    """UV1 'Lightmap' for all `objs`, packed together into one 0..1 atlas.
    method "pack": box projection + Blender pack_islands (rooms: few, large islands).
    method "plane": uvtools.plane_lightmap (devices/racks: ~1 island per face, which
    pack_islands collapses to zero area -> empty bake, ISSUE-002).
    "auto" = pack, fall back to plane if the result leaves 0..1 or fills < 5 %.
    Island spacing > 2x the bake margin: when several objects bake into one image,
    one object's margin fill otherwise overwrites another object's islands."""
    if method == "plane":
        n, fill = uvtools.plane_lightmap(objs, LM_UV, res, BAKE_MARGIN_PX + 1)   # per side
        for o in objs:
            o.data.uv_layers.active = o.data.uv_layers[LM_UV]
            if "UVMap" in o.data.uv_layers:
                o.data.uv_layers["UVMap"].active_render = True
        print(f"[bake] lightmap UV (plane): {n} rects, fill {fill:.2f}")
        return "plane"
    margin = (2 * BAKE_MARGIN_PX + 2) / res
    for o in objs:
        me = o.data
        if "UVMap" not in me.uv_layers:
            uvtools.box_project(o, 1.0, world=False)
        # exact planar box projection in world metres (smart_project distorted
        # downward-facing quads 1:8 in Blender 4.5); islands = connected faces
        # sharing a projection axis; pack_islands then scales them uniformly
        uvtools.box_project(o, 1.0, name=LM_UV, world=True)
        me.uv_layers.active = me.uv_layers[LM_UV]
        me.uv_layers["UVMap"].active_render = True
    _normalize_uv(objs, LM_UV)
    ts = bpy.context.scene.tool_settings
    ts.use_uv_select_sync = True
    _select(objs)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    # ACTIVE_UDIM (+ normalised input): the default CLOSEST_UDIM packs each island set into
    # the UDIM tile nearest to its world-metre position -> objects away from the origin
    # (rack at x 1.6 m) ended up in tiles > 1 and Cycles baked nothing (ISSUE-002)
    bpy.ops.uv.pack_islands(udim_source="ACTIVE_UDIM", rotate=True, rotate_method="CARDINAL",
                            margin_method="FRACTION", margin=margin, shape_method="AABB")
    bpy.ops.object.mode_set(mode="OBJECT")
    try:
        check_lightmap_uv(objs)
        fill = _uv_area(objs)
    except RuntimeError:
        fill = 0.0
    if method == "auto" and fill < 0.05:
        print(f"[bake] lightmap UV: pack_islands unusable (fill {fill:.3f}) -> plane layout")
        return unwrap_lightmap(objs, res, method="plane")
    print(f"[bake] lightmap UV (pack): fill {fill:.2f}")
    return "pack"


def _denoise(img, exr_path):
    """OIDN via the compositor of a throw-away empty scene. Returns float image."""
    main = bpy.context.window.scene if bpy.context.window else bpy.context.scene
    sc = bpy.data.scenes.new("_lm_denoise")
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 1
    sc.render.resolution_x, sc.render.resolution_y = img.size
    sc.render.resolution_percentage = 100
    cam = bpy.data.objects.new("_lm_cam", bpy.data.cameras.new("_lm_cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    sc.view_settings.view_transform = "Standard"
    sc.use_nodes = True
    nt = sc.node_tree
    nt.nodes.clear()
    src = nt.nodes.new("CompositorNodeImage")
    src.image = img
    dn = nt.nodes.new("CompositorNodeDenoise")
    dn.use_hdr = True
    if hasattr(dn, "prefilter"):
        dn.prefilter = "ACCURATE"
    comp = nt.nodes.new("CompositorNodeComposite")
    nt.links.new(src.outputs["Image"], dn.inputs["Image"])
    nt.links.new(dn.outputs["Image"], comp.inputs["Image"])
    sc.render.image_settings.file_format = "OPEN_EXR"
    sc.render.image_settings.color_depth = "32"
    sc.render.filepath = str(exr_path)
    bpy.ops.render.render(write_still=True, scene=sc.name)
    bpy.data.objects.remove(cam)
    bpy.data.scenes.remove(sc)
    if bpy.context.window:
        bpy.context.window.scene = main
    return bpy.data.images.load(str(exr_path), check_existing=False)


def _linear_to_srgb(x):
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def bake_lightmap(group, objs, out_dir, res=1024, samples=128, denoise=True):
    """Bake irradiance of `objs` into one atlas. Returns (png_image, scale, stats)."""
    _cycles(samples)
    raw = bpy.data.images.new(f"LM_{group}_raw", res, res, alpha=True, float_buffer=True)
    mats = {s.material for o in objs for s in o.material_slots if s.material is not None}
    for m in mats:
        nt = m.node_tree
        node = nt.nodes.get("LM_TARGET") or nt.nodes.new("ShaderNodeTexImage")
        node.name = "LM_TARGET"
        node.image = raw
        nt.nodes.active = node
    for o in objs:
        o.data.uv_layers.active = o.data.uv_layers[LM_UV]
    _select(objs)
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"},
                        margin=BAKE_MARGIN_PX, margin_type="EXTEND", use_clear=True)
    coverage = _pixels(raw)[:, 3] > 0.5
    if not coverage.any():          # ISSUE-002: never again an empty bake without an error
        raise RuntimeError(f"lightmap bake {group}: no texel written (alpha 0 everywhere) - "
                           "check UV 'Lightmap' range / active UV / LM_TARGET / selection")
    src = raw
    if denoise:
        try:
            src = _denoise(raw, Path(out_dir) / f"LM_{group}_denoised.exr")
        except Exception as e:  # keep going with the raw bake, but say so loudly
            print(f"[bake] WARNING: denoise failed for {group}: {e!r} -> using raw bake")
    px = _pixels(src)
    lum = px[:, :3] @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    valid = coverage & np.isfinite(lum)
    scale = float(np.percentile(lum[valid], 99.5)) if valid.any() else 1.0
    scale = scale if scale > 1e-6 else 1.0
    enc = np.ones_like(px)
    enc[:, :3] = _linear_to_srgb(np.clip(np.nan_to_num(px[:, :3]) / scale, 0.0, 1.0))
    img = bpy.data.images.new(f"LM_{group}", res, res, alpha=False)
    img.colorspace_settings.name = "Non-Color"
    img.pixels.foreach_set(enc.ravel())
    png = _save_png(img, Path(out_dir) / f"LM_{group}.png")
    p = Path(png).resolve()
    stats = {"png": str(p.relative_to(ROOT) if p.is_relative_to(ROOT) else p.name), "res": res, "samples": samples, "scale": scale, "coverage": float(coverage.mean()),
             "mean_encoded": float(enc[valid, :3].mean()) if valid.any() else 0.0,
             "clipped_frac": float((px[valid, :3].max(axis=1) > scale).mean()) if valid.any() else 0.0,
             "denoised": src is not raw}
    print(f"[bake] lightmap {group}: {stats}")
    return img, scale, stats


# --- 3. export -------------------------------------------------------------------
def _export_material(mat, group, scale):
    em = mat.copy()
    em.name = f"{mat.name}__{group}"
    nt = em.node_tree
    if "LM_TARGET" in nt.nodes:
        nt.nodes.remove(nt.nodes["LM_TARGET"])
    em["lightmap_intensity"] = scale
    em["lightmap_encoding"] = "srgb"
    em["lightmap_texcoord"] = 1
    em["lightmap_group"] = group
    return em


def _glb_read(path):
    b = Path(path).read_bytes()
    magic, ver, total = struct.unpack_from("<III", b, 0)
    assert magic == 0x46546C67 and ver == 2, "not a glTF 2 GLB"
    jlen, jtype = struct.unpack_from("<II", b, 12)
    doc = json.loads(b[20:20 + jlen])
    off = 20 + jlen
    blen, btype = struct.unpack_from("<II", b, off)
    return doc, bytearray(b[off + 8:off + 8 + blen])


def _glb_write(path, doc, binbuf):
    js = json.dumps(doc, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    binbuf += b"\0" * (-len(binbuf) % 4)
    doc_len = 12 + 8 + len(js) + 8 + len(binbuf)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, doc_len))
        f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        f.write(struct.pack("<II", len(binbuf), 0x004E4942) + bytes(binbuf))


def inject_lightmaps(path, pngs):
    """Add each group's lightmap PNG as image/texture and set it as
    occlusionTexture (texCoord 1) on every material with extras.lightmap_group.
    Verifies that every such primitive has TEXCOORD_1. Returns a report dict."""
    doc, binbuf = _glb_read(path)
    doc.setdefault("images", []), doc.setdefault("textures", []), doc.setdefault("samplers", [])
    doc["samplers"].append({"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071})
    sampler = len(doc["samplers"]) - 1
    tex_of = {}
    for group, png in pngs.items():
        data = Path(png).read_bytes()
        binbuf += b"\0" * (-len(binbuf) % 4)
        doc["bufferViews"].append({"buffer": 0, "byteOffset": len(binbuf), "byteLength": len(data)})
        binbuf += data
        doc["images"].append({"bufferView": len(doc["bufferViews"]) - 1, "mimeType": "image/png",
                              "name": f"LM_{group}"})
        doc["textures"].append({"sampler": sampler, "source": len(doc["images"]) - 1, "name": f"LM_{group}"})
        tex_of[group] = len(doc["textures"]) - 1
    lm_mats = set()
    for i, m in enumerate(doc.get("materials", [])):
        g = m.get("extras", {}).get("lightmap_group")
        if g is None:
            continue
        if "occlusionTexture" in m:
            raise RuntimeError(f"material {m.get('name')} already has an occlusion texture")
        m["occlusionTexture"] = {"index": tex_of[g], "texCoord": 1}
        lm_mats.add(i)
    missing = []
    for mesh in doc.get("meshes", []):
        for prim in mesh["primitives"]:
            if prim.get("material") in lm_mats and "TEXCOORD_1" not in prim["attributes"]:
                missing.append(mesh.get("name"))
    if missing:
        raise RuntimeError(f"TEXCOORD_1 missing on lightmapped meshes: {missing[:10]}")
    doc["buffers"][0]["byteLength"] = len(binbuf)
    _glb_write(path, doc, binbuf)
    return {"lightmapped_materials": len(lm_mats), "lightmaps": len(pngs)}


def export_glb(name, groups, lightmaps, unbaked=()):
    """Swap in per-group export materials, export, inject the lightmaps.
    lightmaps: {group: (png_path, scale)}. Writes assets/out/<name>.raw.glb."""
    for group, objs in groups.items():
        _png, scale = lightmaps[group]
        cache = {}
        for o in objs:
            for slot in o.material_slots:
                m = slot.material
                if m is None:
                    continue
                if m.name not in cache:
                    cache[m.name] = _export_material(m, group, scale)
                slot.material = cache[m.name]
    objs = [o for g in groups.values() for o in g] + list(unbaked)
    for o in objs:   # non-JSON-friendly props off the export
        for k in ("slots",):
            if k in o:
                del o[k]
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"{name}.raw.glb"
    _select(objs)
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format="GLB", use_selection=True, export_extras=True,
        export_apply=True, export_yup=True, export_texcoords=True, export_normals=True,
        export_materials="EXPORT", export_image_format="AUTO", export_cameras=False,
        export_lights=False)
    rep = inject_lightmaps(path, {g: png for g, (png, _s) in lightmaps.items()})
    print(f"[bake] exported {path} ({path.stat().st_size / 1e6:.1f} MB) {rep}")
    return path


def apply_modifiers(objs):
    """Bake the modifier stack (bevels) into the meshes, so the lightmap UVs are
    unwrapped on the final geometry."""
    objs = [o for o in objs if o.type == "MESH" and o.modifiers]
    if objs:
        _select(objs)
        bpy.ops.object.convert(target="MESH")
    return len(objs)


ROLE = (("coreswitch", "cs"), ("switch", "sw"), ("patchpanel", "pp"), ("server", "srv"), ("pdu", "pdu"), ("notebook", "nb"), ("router", "rt"), ("firewall", "fw"), ("kvm", "kvm"), ("desk_strip", "sl"), ("table_outlet", "td"))


def write_room_manifest(name, objs):
    """Raum-Manifest (docs/SCENARIO_API.md E1): GLB-Node <-> Kern-ID fuer jedes Geraet mit Ports
    oder LEDs. Kern-IDs pro Rolle, im Rack von oben nach unten (hoechste HE zuerst), 0U zuletzt:
    sw1 = oberster Switch, pp1 = oberstes Patchpanel ... -> assets/out/<name>.manifest.json"""
    devs = [o for o in objs if "leyonet_type" in o]
    rows = []
    for o in devs:
        role = next((r for key, r in ROLE if o["leyonet_type"].startswith(key)), None)
        kids = [c for c in o.children if "leyonet_overlay" in c]
        ports = {c["leyonet_port"]: c["leyonet_port_kind"] for c in kids if c["leyonet_overlay"] == "port"}
        leds = sorted(c.name[len(o.name) + len("_led_"):] for c in kids if c["leyonet_overlay"] == "led")
        if role is None or not (ports or leds):
            continue
        rack = o.parent.name if o.parent else ""
        rows.append((role, rack, -float(o.get("rack_u", -1)), o.name, o["leyonet_type"], ports, leds))
    rows.sort()
    count, devices = {}, []
    for role, rack, _negu, node, typ, ports, leds in rows:
        count[role] = count.get(role, 0) + 1
        devices.append({"id": f"{role}{count[role]}", "node": node, "type": typ, "rack": rack,
                        "ports": dict(sorted(ports.items())), "leds": leds})
    out = OUT_DIR / f"{name}.manifest.json"
    out.write_text(json.dumps({"room": name, "version": 1, "devices": devices}, indent=1))
    print(f"[bake] manifest {out.name}: {[(d['id'], d['node']) for d in devices]}")
    return out


def bake_and_export(name, groups, unbaked=(), res=None, samples=128, default_res=1024):
    """Full pipeline for already-textured objects (see bake_all_procedural).
    `res` maps group -> lightmap resolution. Writes a JSON manifest next to the glb."""
    build = BUILD_DIR / name
    lightmaps, manifest = {}, {"name": name, "groups": {}}
    apply_modifiers([o for g in groups.values() for o in g] + list(unbaked))
    for group, objs in groups.items():
        r = (res or {}).get(group, default_res)
        unwrap_lightmap(objs, res=r)
        check_lightmap_uv(objs)
        img, scale, stats = bake_lightmap(group, objs, build, res=r, samples=samples)
        lightmaps[group] = (stats["png"], scale)
        manifest["groups"][group] = {"objects": len(objs), **stats}
    path = export_glb(name, groups, lightmaps, unbaked)
    manifest["raw_glb"] = str(path.relative_to(ROOT))
    manifest["optimize"] = OPTIMIZE_CMD.format(src=path.relative_to(ROOT),
                                               tmp=(OUT_DIR / f"{name}.opt.glb").relative_to(ROOT),
                                               dst=(OUT_DIR / f"{name}.glb").relative_to(ROOT))
    manifest["room_manifest"] = str(write_room_manifest(
        name, [o for g in groups.values() for o in g] + list(unbaked)).relative_to(ROOT))
    (OUT_DIR / f"{name}.bake.json").write_text(json.dumps(manifest, indent=2))
    return path, manifest


def export_kit(name, templates, meta=None):
    """Plan v3 Bausatz: Vorlagen-Objekte (je Geraetetyp eines, mit Overlay-Kindern) OHNE Lightmap
    exportieren - das Spiel klont sie zur Laufzeit in Racks/Tischplaetze (Licht: PMREM-Environment,
    AO steckt im Panel-Atlas). Schreibt <name>.raw.glb, <name>.kit.json (Typen, HE, Ports, LEDs,
    Einbau-Masse in glTF-Koordinaten) und <name>.bake.json (OPTIMIZE_CMD)."""
    objs = []
    for t in templates:
        objs += [o for o in _descendants_all(t)]
    apply_modifiers(objs)
    path = export_glb(name, {}, {}, unbaked=objs)
    kit = {"kit": name, "version": 1, "coords": "glTF (y up, -z = Blender +y)", "templates": []}
    def owner(o):   # naechster Vorfahre mit leyonet_type (Geraet), sonst die Vorlage
        q = o.parent
        while q is not None and "leyonet_type" not in q:
            q = q.parent
        return q

    def device_row(d):
        kids = [c for c in _descendants_all(d) if "leyonet_overlay" in c and c is not d and owner(c) is d]
        ports = {c["leyonet_port"]: c["leyonet_port_kind"] for c in kids if c["leyonet_overlay"] == "port"}
        leds = sorted(c.name[len(d.name) + len("_led_"):] for c in kids if c["leyonet_overlay"] == "led")
        return {"node": d.name, "type": d.get("leyonet_type", d.get("leyonet_kind", "")),
                "he": int(d.get("he", 0)), "ports": dict(sorted(ports.items())), "leds": leds}

    for t in templates:
        row = device_row(t)
        subs = [c for c in _descendants_all(t) if c is not t and "leyonet_type" in c]
        if subs:   # z.B. Rack mit 2 PDU-0U
            row["parts"] = [device_row(c) | {"suffix": c.name[len(t.name) + 1:]} for c in subs]
        row.update((meta or {}).get(t.name, {}))
        kit["templates"].append(row)
    (OUT_DIR / f"{name}.kit.json").write_text(json.dumps(kit, indent=1))
    manifest = {"name": name, "raw_glb": str(path.relative_to(ROOT)), "lightmaps": "none (Bausatz)",
                "optimize": OPTIMIZE_CMD.format(src=path.relative_to(ROOT),
                                                tmp=(OUT_DIR / f"{name}.opt.glb").relative_to(ROOT),
                                                dst=(OUT_DIR / f"{name}.glb").relative_to(ROOT))}
    (OUT_DIR / f"{name}.bake.json").write_text(json.dumps(manifest, indent=2))
    print(f"[bake] kit {name}: {[(r['node'], r['type'], r['he']) for r in kit['templates']]}")
    return path, kit


def _descendants_all(obj):
    out, stack = [], [obj]
    while stack:
        o = stack.pop()
        out.append(o)
        stack.extend(o.children)
    return out


def export_character_glb(name, armature, meshes, jpeg_quality=88, filename=None):
    """Skinned character export (no lightmap): one armature + its meshes, every
    NLA track of the armature becomes one glTF animation named like the track.
    No Draco here (gltf-transform does that afterwards, see OPTIMIZE_CMD).
    Writes assets/out/<filename or name.glb>; returns (path, clip_names)."""
    ad = armature.animation_data
    ad.action = None   # only NLA tracks, no extra 'active action' clip
    for t in ad.nla_tracks:
        t.mute = False
        t.is_solo = False
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / (filename or f"{name}.glb")
    _select([armature, *meshes])
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format="GLB", use_selection=True, export_extras=False,
        export_yup=True, export_texcoords=True, export_normals=True, export_tangents=False,
        export_materials="EXPORT", export_image_format="AUTO", export_jpeg_quality=jpeg_quality,
        export_image_quality=jpeg_quality,
        export_cameras=False, export_lights=False, export_apply=False,
        export_skins=True, export_all_influences=False, export_def_bones=False,
        export_animations=True, export_animation_mode="NLA_TRACKS", export_force_sampling=True,
        export_anim_slide_to_zero=True, export_optimize_animation_size=True,
        export_reset_pose_bones=True, export_morph=False,
        export_draco_mesh_compression_enable=False)
    clips = _glb_read(path)[0].get("animations", [])
    names = [a.get("name") for a in clips]
    print(f"[bake] character {path} ({path.stat().st_size / 1e6:.2f} MB) clips={names}")
    return path, names


# --- verification ------------------------------------------------------------------
def preview_from_glb(path):
    """Import an exported glb and turn every lightmapped material into
    albedo * lightmap * intensity (+ emission) on a Principled BSDF, so a render
    with no lights shows exactly what the baked file carries."""
    bpy.ops.import_scene.gltf(filepath=str(path))
    n_lm = 0
    for m in bpy.data.materials:
        if not m.use_nodes or "lightmap_intensity" not in m:
            continue
        nt = m.node_tree
        bsdf = _bsdf(m)
        grp = next((n for n in nt.nodes if n.type == "GROUP" and "Occlusion" in n.inputs
                    and n.inputs["Occlusion"].is_linked), None)
        if grp is None:
            continue
        node = grp.inputs["Occlusion"].links[0].from_node
        while node.type != "TEX_IMAGE":
            node = next(i for i in node.inputs if i.is_linked).links[0].from_node
        lm = node.outputs["Color"]
        bc = bsdf.inputs["Base Color"]
        if bc.is_linked:
            base = bc.links[0].from_socket
        else:
            rgb = nt.nodes.new("ShaderNodeRGB")
            rgb.outputs[0].default_value = bc.default_value
            base = rgb.outputs[0]
        mul = nt.nodes.new("ShaderNodeVectorMath")
        mul.operation = "MULTIPLY"
        nt.links.new(base, mul.inputs[0])
        nt.links.new(lm, mul.inputs[1])
        sc = nt.nodes.new("ShaderNodeVectorMath")
        sc.operation = "SCALE"
        nt.links.new(mul.outputs[0], sc.inputs[0])
        sc.inputs["Scale"].default_value = float(m["lightmap_intensity"])
        e_col = bsdf.inputs["Emission Color"].default_value
        e_str = bsdf.inputs["Emission Strength"].default_value
        add = nt.nodes.new("ShaderNodeVectorMath")
        add.operation = "ADD"
        nt.links.new(sc.outputs[0], add.inputs[0])
        add.inputs[1].default_value = (e_col[0] * e_str, e_col[1] * e_str, e_col[2] * e_str)
        for s in ("Base Color", "Normal", "Emission Color"):
            for lk in list(bsdf.inputs[s].links):
                nt.links.remove(lk)
        bsdf.inputs["Base Color"].default_value = (0, 0, 0, 1)
        bsdf.inputs["Specular IOR Level"].default_value = 0.0
        bsdf.inputs["Roughness"].default_value = 1.0
        for lk in list(bsdf.inputs["Roughness"].links):
            nt.links.remove(lk)
        nt.links.new(add.outputs[0], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = 1.0
        n_lm += 1
    print(f"[bake] preview: {n_lm} lightmapped materials rewired")
    return n_lm
