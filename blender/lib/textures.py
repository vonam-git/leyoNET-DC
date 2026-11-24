"""PBR texture-set materials (ambientCG, CC0) for room assets.

Every material: Base Color + NormalGL + Roughness map (Realismus-Regel 2).
- UV0 'UVMap' is in METRES on every object (uvtools.*); each material scales
  its maps with one Mapping node (scale = 1 / tile_m) -> KHR_texture_transform.
- glTF standard maps: Base Color (JPG) + Normal (JPG, tangent/GL) + ONE ORM map
  (JPG: R = ambient occlusion from the set's AO map or 1.0, G = roughness,
  B = metallic) -> metallicRoughnessTexture. Run C: the ORM is SHARED per
  ambientCG asset (assets/build/textures/<asset>_shared_orm.jpg, G normalised to
  the highest target roughness of the asset's materials, B = 1); each material
  scales it with Math-Multiply nodes -> glTF roughnessFactor / metallicFactor.
  Materials with `wear` keep their own ORM (factor 1). ORM is always 1K. The occlusion slot
  of the exported glTF stays reserved for the baked lightmap (bake.py), the
  R channel is carried in the ORM image for a later AO-slot switch.
- Texture size classes (`size`, decision 2026-11-19): 2048 ONLY for the floor (HPL +
  perforated tiles: largest visible surface in ego view, reflects via PMREM), walls
  and subfloor 1024, 512 for the glass smear sets, 1024 for everything else.
  Device panel atlases: 1024 long side (lib.retrofit). (devices, props, door ...); resized copies are cached
  in assets/build/textures/<asset>_<size>_<map>.jpg.
- The roughness channel is derived (assets/build/textures/<name>_orm.jpg):
  shifted to a physically plausible mean (`rough`), plus a seamless
  low-frequency noise for large surfaces (`noise`), plus optional wear
  (Realismus-Regel 4): fingerprints / polished paths as roughness variation.
- Emissive LEDs keep flat Principled colours (lib.materials), allowed by the rule.
"""
from pathlib import Path

import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
ACG = ROOT / "assets" / "textures"          # filled by blender/fetch_ambientcg.py
OUT = ROOT / "assets" / "build" / "textures"

# name -> definition
#   asset: ambientCG id; tile: metres per texture repeat; rough: target mean (None = keep)
#   metal: metallic factor; noise: amplitude of low-freq roughness noise
#   alpha: constant alpha (BLEND); opacity: use the set's Opacity map (MASK)
#   color: target mean albedo (linear RGB); the set's Color map is multiplied by
#          color / mean(map) -> keeps the texture detail, exports as baseColorFactor
#   size: texture size class (base/normal/ORM), default 1024; 2048 = floor/wall
#   nsize: eigene Groesse nur fuer die Normal-Map (Ladegroesse; z.B. Boden: Albedo 2K, Relief 1K)
#   wear: (asset, map, strength, mask) roughness variation; mask None = everywhere,
#         or list of (u, v, radius) blobs in texture space (fraction of one repeat)
SETS = {
    "wall_concrete":       dict(asset="Concrete030", tile=2.0, size=1024, rough=0.85, noise=0.04),
    "subfloor_concrete":   dict(asset="Concrete030", tile=2.0, size=1024, rough=0.88, noise=0.0),  # shares wall images
    "ceiling_paint":       dict(asset="PaintedPlaster017", tile=1.5, rough=0.80, noise=0.04),
    "floor_tile_hpl":      dict(asset="Plastic018A", tile=0.6, size=2048, nsize=1024, rough=0.55, noise=0.03),
    "floor_tile_hpl_worn": dict(asset="Plastic018A", tile=0.6, size=2048, nsize=1024, rough=0.55, noise=0.03,
                                wear=("SurfaceImperfections015", "Opacity", -0.14, None)),
    "floor_tile_perforated": dict(asset="SheetMetal002", tile=0.3, size=1024, rough=0.45, metal=0.0,
                                  color=(0.50, 0.51, 0.52), opacity=True),   # Ref-Vergleich 2026-11-20: hell pulverbeschichtet
    "tile_edge_pvc":       dict(asset="Plastic012A", tile=0.5, rough=0.45),
    "brushed_steel":       dict(asset="Metal009", tile=0.5, rough=0.40, metal=1.0),
    "brushed_steel_fingerprints": dict(asset="Metal009", tile=0.5, rough=0.40, metal=1.0,
                                       wear=("Fingerprints002", "Roughness", 0.4, None)),
    "painted_steel":       dict(asset="Metal027", tile=1.0, rough=0.55),
    "desk_hpl":            dict(asset="Plastic012A", tile=0.5, rough=0.60, noise=0.03,
                                color=(0.42, 0.42, 0.40)),           # Arbeitstisch, HPL lichtgrau
    # door: one repeat covers the whole leaf (tile 2.1 m) so the fingerprint blob
    # around the handle (world x 3.77 / z 1.05 -> u 0.795, v 0.50) is unique
    "door_painted_worn":   dict(asset="Metal027", tile=2.1, rough=0.55, noise=0.02,
                                wear=("Fingerprints002", "Roughness", 0.6,
                                      [(0.80, 0.50, 0.07), (0.76, 0.62, 0.06)])),
    # --- rack + devices (lib.devices) -------------------------------------------
    # rack housing: brushed steel, grain along each part (uvtools.box_project_aligned)
    "rack_brushed":        dict(asset="Metal009", tile=0.5, rough=0.38, metal=1.0, noise=0.04),
    "rack_black":          dict(asset="Metal027", tile=0.5, rough=0.55, noise=0.03,
                                color=(0.012, 0.012, 0.013)),        # RAL 9005 powder coat
    "rack_powder":         dict(asset="Metal027", tile=0.5, rough=0.50, noise=0.03,
                                color=(0.040, 0.041, 0.045)),        # Rack-Gehaeuse RAL 9005 matt (~4 % Reflexion)
    "rack_plinth":         dict(asset="Metal027", tile=0.5, rough=0.70,
                                color=(0.008, 0.008, 0.009)),
    "steel_zinc":          dict(asset="Metal009", tile=0.3, rough=0.36, metal=1.0),
    "device_dark":         dict(asset="Metal027", tile=0.5, rough=0.45, noise=0.02,
                                color=(0.032, 0.033, 0.037)),
    "device_silver":       dict(asset="Metal009", tile=0.4, rough=0.32, metal=1.0),
    # Notebook (lib.furniture.build_notebook): eloxiertes Alu "space grey" + matte Tastenkappen
    "laptop_alu":          dict(asset="Metal009", tile=0.3, rough=0.38, metal=1.0, noise=0.03,
                                color=(0.16, 0.165, 0.175)),
    "keycap":              dict(asset="Plastic012A", tile=0.1, rough=0.62, noise=0.02,
                                color=(0.018, 0.018, 0.020)),
    "touch_glass":         dict(asset="Plastic012A", tile=0.2, rough=0.22,
                                color=(0.09, 0.092, 0.098),
                                wear=("Fingerprints002", "Roughness", 0.20, None)),   # Regel 4: Fingerspuren
    "rubber":              dict(asset="Plastic012A", tile=0.1, rough=0.90,
                                color=(0.008, 0.008, 0.009)),        # Gummifuesse / Displaydichtung
    "screw":               dict(asset="Metal009", tile=0.1, rough=0.30, metal=1.0),
    "plastic_grey":        dict(asset="Plastic012A", tile=0.2, rough=0.50,
                                color=(0.10, 0.10, 0.11)),
    "plastic_black":       dict(asset="Plastic012A", tile=0.2, rough=0.55,
                                color=(0.012, 0.012, 0.013)),
    "port_black":          dict(asset="Plastic012A", tile=0.2, rough=0.85,
                                color=(0.004, 0.004, 0.004)),
    "port_vga":            dict(asset="Plastic012A", tile=0.2, rough=0.50,
                                color=(0.02, 0.05, 0.18)),
    "label_white":         dict(asset="Plastic012A", tile=0.2, rough=0.60,
                                color=(0.80, 0.80, 0.78)),
    "display_glass":       dict(asset="Plastic012A", tile=0.2, rough=0.12,
                                color=(0.005, 0.005, 0.006)),
    # --- Raum v3 (lib.room_v3, Plan v3) -------------------------------------------------
    "window_alu":          dict(asset="Metal009", tile=0.5, rough=0.32, metal=1.0, noise=0.02,
                                color=(0.55, 0.56, 0.58)),           # Pfosten-Riegel-Fassade, eloxiert
    "glass_front":         dict(asset="Smear004", tile=1.5, size=512, rough=None, alpha=0.10),
    "outside_paving":      dict(asset="PavingStones070", tile=2.5, size=1024, nsize=512, rough=0.80, noise=0.03),
    "floor_marking":       dict(asset="Plastic012A", tile=0.3, rough=0.55,
                                color=(0.70, 0.52, 0.04)),           # gelbes Bodenmarkierungsband
    "chair_fabric":        dict(asset="Fabric030", tile=0.3, size=512, rough=0.90, noise=0.02,
                                color=(0.035, 0.037, 0.042)),        # Buerostuhl, anthrazit
    # --- cabling + room props --------------------------------------------------------
    "cable_blue":          dict(asset="Plastic012A", tile=0.1, rough=0.45,
                                color=(0.02, 0.10, 0.45)),           # Cat6 PVC jacket
    "cable_yellow":        dict(asset="Plastic012A", tile=0.1, rough=0.45,
                                color=(0.60, 0.42, 0.02)),
    "cable_grey":          dict(asset="Plastic012A", tile=0.1, rough=0.45,
                                color=(0.25, 0.26, 0.27)),
    "cardboard":           dict(asset="Cardboard004", tile=0.6, rough=0.85, noise=0.03,
                                wear=("SurfaceImperfections015", "Opacity", 0.05, None)),
    "extinguisher_red":    dict(asset="PaintedMetal004", tile=0.4, rough=0.30, noise=0.02,
                                color=(0.42, 0.012, 0.010)),         # RAL 3000 gloss paint
    "tape":                dict(asset="Plastic012A", tile=0.2, rough=0.25,
                                color=(0.42, 0.30, 0.12)),           # brown packing tape
    "boot_clear":          dict(asset="Plastic012A", tile=0.1, rough=0.30,
                                color=(0.55, 0.57, 0.60)),           # RJ45 strain-relief boot
    "switch_white":        dict(asset="Plastic012A", tile=0.2, rough=0.45, color=(0.78, 0.78, 0.76)),   # Plan v4: Lichtschalter
    "sign_housing":        dict(asset="Plastic012A", tile=0.3, rough=0.40,
                                color=(0.80, 0.80, 0.78)),
    # --- glazing ---------------------------------------------------------------------
    "glass_smudged":       dict(asset="Smear004", tile=1.0, size=512, rough=None, alpha=0.15),  # subtle smear relief
    "polycarbonate_smudged": dict(asset="Smear004", tile=1.2, size=512, rough=None, alpha=0.22),
}


SIZE_DEFAULT = 1024
ORM_SIZE = 1024          # Run C: ORM 1K everywhere (also floor/wall)
JPEG_QUALITY = 90


def _map(asset, kind, required=True):
    p = ACG / asset / f"{asset}_2K-JPG_{kind}.jpg"
    if not p.exists():
        if required:
            raise FileNotFoundError(p)
        return None
    return p


def _sized(asset, kind, size):
    """Path of the set's `kind` map at `size` px (2K source used as is, smaller
    sizes are resampled once into assets/build/textures/)."""
    src = _map(asset, kind)
    if size >= 2048:
        return src
    out = OUT / f"{asset}_{size}_{kind}.jpg"
    if not out.exists() or out.stat().st_mtime < src.stat().st_mtime:
        OUT.mkdir(parents=True, exist_ok=True)
        img = bpy.data.images.load(str(src), check_existing=False)
        img.colorspace_settings.name = "Non-Color"      # resample the stored values
        img.scale(size, size)
        img.filepath_raw = str(out)
        img.file_format = "JPEG"
        img.save(filepath=str(out), quality=JPEG_QUALITY)
        bpy.data.images.remove(img)
    return out


def _gray_sized(path, size):
    img = bpy.data.images.load(str(path), check_existing=False)
    img.colorspace_settings.name = "Non-Color"
    if img.size[0] != size:
        img.scale(size, size)
    g = _gray(img)
    bpy.data.images.remove(img)
    return g


def _load(path, colorspace):
    img = bpy.data.images.load(str(path), check_existing=True)
    img.colorspace_settings.name = colorspace
    return img


def _gray(img):
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)[..., 0].copy()


def _periodic_noise(shape, scale_px, seed):
    """Seamless low-frequency noise in [-1, 1] (Gaussian-filtered white noise in
    the Fourier domain -> periodic by construction)."""
    rng = np.random.default_rng(seed)
    f = np.fft.fft2(rng.standard_normal(shape))
    ky = np.fft.fftfreq(shape[0])[:, None]
    kx = np.fft.fftfreq(shape[1])[None, :]
    f *= np.exp(-((kx ** 2 + ky ** 2) * (scale_px ** 2)) * 2.0)
    n = np.real(np.fft.ifft2(f))
    return n / (np.abs(n).max() + 1e-9)


def _blob_mask(shape, blobs):
    h, w = shape
    v, u = np.mgrid[0:h, 0:w]
    u = u / w
    v = 1.0 - v / h               # image rows go top->bottom, UV v goes up
    m = np.zeros(shape, dtype=np.float32)
    for bu, bv, r in blobs:
        m = np.maximum(m, np.exp(-((u - bu) ** 2 + (v - bv) ** 2) / (2 * r * r)))
    return m


_MEANS = {}


def _tint(img, target):
    """Per-channel factor that moves the mean (linear) albedo of `img` to `target`."""
    if img.name not in _MEANS:
        w, h = img.size                       # read the original (a fresh copy has no pixels yet)
        a = np.empty(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(a)
        a = a.reshape(h, w, 4)[::8, ::8, :3]
        if a.max() <= 0.0:
            raise RuntimeError(f"tint: no pixel data in {img.name}")
        lin = np.power(np.clip(a.reshape(-1, 3), 0, 1), 2.2)          # pixels are sRGB-encoded
        _MEANS[img.name] = lin.mean(0)
    m = _MEANS[img.name]
    return tuple(float(t / max(c, 1e-4)) for t, c in zip(target, m))


def _recolor(src_path, name, ratio):
    """Albedo too dark for a <= 1 glTF factor: bake `ratio` (linear) into a
    per-material copy, texture detail kept (normalised to the mean)."""
    out = OUT / f"{name}_Color.jpg"
    img = bpy.data.images.load(str(src_path), check_existing=False)
    img.colorspace_settings.name = "Non-Color"
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    a = a.reshape(-1, 4)
    lin = np.power(np.clip(a[:, :3], 0, 1), 2.2) * np.asarray(ratio, dtype=np.float32)
    a[:, :3] = np.power(np.clip(lin, 0, 1), 1 / 2.2)
    img.pixels.foreach_set(a.ravel())
    img.filepath_raw = str(out)
    img.file_format = "JPEG"
    img.save(filepath=str(out), quality=JPEG_QUALITY)
    bpy.data.images.remove(img)
    return out


def _roughness(d, size, rough, noise, seed):
    """Roughness channel of set `d` shifted to mean `rough`, plus noise and wear."""
    r = _gray_sized(_map(d["asset"], "Roughness"), size)
    src_mean = float(r.mean())
    if rough is not None:
        r = r - r.mean() + rough
    if noise:
        r = r + noise * _periodic_noise(r.shape, scale_px=r.shape[0] / 6, seed=seed)
    if d.get("wear"):
        w_asset, w_map, k, blobs = d["wear"]
        w = _gray_sized(_map(w_asset, w_map), size)
        w = (w - w.mean()) if w_map == "Roughness" else w      # roughness: deviation; masks: 0..1
        if blobs:
            w = w * _blob_mask(r.shape, blobs)
        r = r + k * w
    return np.clip(r, 0.02, 1.0), src_mean


def _write_orm(out, ao, r, metal):
    OUT.mkdir(parents=True, exist_ok=True)
    h, wd = r.shape
    img = bpy.data.images.new(f"{out.stem}_tmp", wd, h, alpha=False)
    img.colorspace_settings.name = "Non-Color"
    rgba = np.ones((h, wd, 4), dtype=np.float32)
    rgba[..., 0], rgba[..., 1], rgba[..., 2] = ao, r, metal
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = str(out)
    img.file_format = "JPEG"
    img.save(filepath=str(out), quality=JPEG_QUALITY)
    bpy.data.images.remove(img)


def _ao(asset, like):
    ao_path = _map(asset, "AmbientOcclusion", required=False)
    return (_gray_sized(ao_path, ORM_SIZE) if ao_path else np.ones_like(like)), bool(ao_path)


def orm_group(asset):
    """Shared-ORM parameters of `asset`: base mean (max target roughness of its
    non-wear materials), noise (max of the group)."""
    ds = [d for d in SETS.values() if d["asset"] == asset and not d.get("wear")]
    roughs = [d["rough"] for d in ds if d.get("rough") is not None]
    base = min(1.0, max(roughs)) if roughs else None
    return base, max((d.get("noise", 0.0) for d in ds), default=0.0)


def derived_orm(name):
    """ORM for material `name` -> (path, stats). stats['rough_factor'] /
    stats['metal_factor'] are the per-material glTF factors.
    - wear materials: own <name>_orm.jpg, roughness mean = `rough`, factors (1, metal)
    - all others: shared <asset>_shared_orm.jpg, G mean = group base, B = 1,
      factors (rough / base, metal)"""
    d = SETS[name]
    metal = float(d.get("metal", 0.0))
    if d.get("wear"):
        out = OUT / f"{name}_orm.jpg"
        r, src_mean = _roughness(d, ORM_SIZE, d.get("rough"), d.get("noise"), sum(name.encode()))
        ao, has_ao = _ao(d["asset"], r)
        _write_orm(out, ao, r, metal)
        rf, mf, shared = 1.0, 1.0, False
    else:
        base, noise = orm_group(d["asset"])
        out = OUT / f"{d['asset']}_shared_orm.jpg"
        if out not in _SHARED:
            r, src_mean = _roughness(d | {"wear": None}, ORM_SIZE, base, noise, sum(d["asset"].encode()))
            ao, has_ao = _ao(d["asset"], r)
            _write_orm(out, ao, r, 1.0)
            _SHARED[out] = (float(r.mean()), src_mean, has_ao)
        g_mean, src_mean, has_ao = _SHARED[out]
        target = d.get("rough")
        rf = 1.0 if target is None else min(1.0, target / g_mean)
        mf, shared = metal, True
    stats = {"src_mean": src_mean, "size": ORM_SIZE, "ao": has_ao, "metal": metal,
             "rough_factor": rf, "metal_factor": mf, "shared": shared}
    return out, stats


_SHARED = {}   # shared ORM path -> (G mean, source mean, has AO), once per Blender session


def get(name):
    """Principled material `name` from SETS (created once per file)."""
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat
    d = SETS[name]
    size = d.get("size", SIZE_DEFAULT)
    orm_path, stats = derived_orm(name)
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    uv = nt.nodes.new("ShaderNodeUVMap")
    uv.uv_map = "UVMap"
    mp = nt.nodes.new("ShaderNodeMapping")
    s = 1.0 / d["tile"]
    mp.inputs["Scale"].default_value = (s, s, 1.0)
    nt.links.new(uv.outputs["UV"], mp.inputs["Vector"])

    def tex(path, cs):
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = _load(path, cs)
        nt.links.new(mp.outputs["Vector"], t.inputs["Vector"])
        return t

    col = tex(_sized(d["asset"], "Color", size), "sRGB")
    tint = None
    if d.get("color"):
        tint = _tint(col.image, d["color"])
        if max(tint) > 1.0:               # brighter than the set: own albedo, no factor
            col.image = _load(_recolor(_sized(d["asset"], "Color", size), name, tint), "sRGB")
            tint = None
    if tint:
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        sock = {i.identifier: i for i in mix.inputs}          # names are ambiguous on Mix
        sock["Factor_Float"].default_value = 1.0
        nt.links.new(col.outputs["Color"], sock["A_Color"])
        sock["B_Color"].default_value = (*tint, 1.0)          # -> glTF baseColorFactor
        out = next(o for o in mix.outputs if o.identifier == "Result_Color")
        nt.links.new(out, bsdf.inputs["Base Color"])
    else:
        nt.links.new(col.outputs["Color"], bsdf.inputs["Base Color"])
    orm = tex(orm_path, "Non-Color")
    orm.label = "ORM"
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(orm.outputs["Color"], sep.inputs["Color"])
    for ch, sock, f in (("Green", "Roughness", stats["rough_factor"]),
                        ("Blue", "Metallic", stats["metal_factor"])):
        mul = nt.nodes.new("ShaderNodeMath")          # -> glTF roughnessFactor / metallicFactor
        mul.operation = "MULTIPLY"
        mul.label = f"{sock} factor"
        nt.links.new(sep.outputs[ch], mul.inputs[0])
        mul.inputs[1].default_value = f
        nt.links.new(mul.outputs[0], bsdf.inputs[sock])
    nrm = tex(_sized(d["asset"], "NormalGL", d.get("nsize", size)), "Non-Color")   # nsize: Normal-Map kleiner
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nm.uv_map = "UVMap"
    nt.links.new(nrm.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    if d.get("opacity"):
        op = tex(_sized(d["asset"], "Opacity", size), "Non-Color")
        rnd = nt.nodes.new("ShaderNodeMath")
        rnd.operation = "ROUND"                       # glTF alphaMode MASK, cutoff 0.5
        nt.links.new(op.outputs["Color"], rnd.inputs[0])
        nt.links.new(rnd.outputs[0], bsdf.inputs["Alpha"])
        mat.surface_render_method = "DITHERED"
    elif d.get("alpha") is not None:
        bsdf.inputs["Alpha"].default_value = d["alpha"]
        mat.surface_render_method = "BLENDED"
    mat["texset"] = {"source": "ambientCG", "asset": d["asset"], "license": "CC0",
                     "tile_m": d["tile"], "size": size, "orm": orm_path.name,
                     "rough_factor": round(stats["rough_factor"], 4),
                     "metal_factor": stats["metal_factor"], "orm_ao": stats["ao"]}
    if tint:
        mat["texset"]["tint"] = [round(t, 4) for t in tint]
    return mat
