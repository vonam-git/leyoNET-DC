"""GLB report (plain python3, no Blender): file size, triangles, textures per
size class and format, maps per material.

    python3 blender/glb_report.py assets/out/x.glb [more.glb ...] [--json out.json]
"""
import io
import json
import struct
import sys
from collections import Counter
from pathlib import Path


def read_glb(path):
    b = Path(path).read_bytes()
    magic, ver, _ = struct.unpack_from("<III", b, 0)
    assert magic == 0x46546C67 and ver == 2, f"{path}: not a glTF 2 GLB"
    jlen = struct.unpack_from("<I", b, 12)[0]
    doc = json.loads(b[20:20 + jlen])
    off = 20 + jlen
    blen = struct.unpack_from("<I", b, off)[0] if off < len(b) else 0
    return doc, b[off + 8:off + 8 + blen], len(b)


def image_size(data, mime):
    if mime == "image/ktx2":
        return struct.unpack_from("<II", data, 20)          # pixelWidth, pixelHeight
    if mime == "image/png":
        return struct.unpack_from(">II", data, 16)
    if mime == "image/jpeg":
        i = 2
        while i < len(data):
            if data[i] != 0xFF:
                i += 1
                continue
            m = data[i + 1]
            seg = struct.unpack_from(">H", data, i + 2)[0]
            if m in (0xC0, 0xC1, 0xC2):
                h, w = struct.unpack_from(">HH", data, i + 5)
                return w, h
            i += 2 + seg
    if mime == "image/webp":
        from PIL import Image
        return Image.open(io.BytesIO(data)).size
    return (0, 0)


def size_class(w, h):
    m = max(w, h)
    for c in (4096, 2048, 1024, 512, 256):
        if m >= c:
            return f"{c // 1024}K" if c >= 1024 else str(c)
    return "<256"


def report(path):
    doc, binbuf, total = read_glb(path)
    bvs = doc.get("bufferViews", [])
    tris = 0
    for mesh in doc.get("meshes", []):
        for p in mesh["primitives"]:
            if p.get("mode", 4) != 4:
                continue
            if "indices" in p:
                tris += doc["accessors"][p["indices"]]["count"] // 3
            else:
                tris += doc["accessors"][p["attributes"]["POSITION"]]["count"] // 3
    # tris of the scene graph (instances counted per node use)
    imgs = []
    for i, im in enumerate(doc.get("images", [])):
        bv = bvs[im["bufferView"]]
        data = binbuf[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]]
        w, h = image_size(data, im.get("mimeType"))
        imgs.append({"name": im.get("name", f"img{i}"), "mime": im.get("mimeType"),
                     "w": w, "h": h, "kb": round(bv["byteLength"] / 1024), "class": size_class(w, h)})
    tex_src = []
    for t in doc.get("textures", []):
        src = t.get("source")
        ext = t.get("extensions", {})
        for k in ("KHR_texture_basisu", "EXT_texture_webp", "EXT_texture_avif"):
            if k in ext:
                src = ext[k]["source"]
        tex_src.append(src)
    mats = []
    for m in doc.get("materials", []):
        pbr = m.get("pbrMetallicRoughness", {})
        maps = {}
        for key, slot in (("baseColor", pbr.get("baseColorTexture")), ("metalRough(ORM)", pbr.get("metallicRoughnessTexture")),
                          ("normal", m.get("normalTexture")), ("occlusion", m.get("occlusionTexture")),
                          ("emissive", m.get("emissiveTexture"))):
            if slot is not None:
                im = imgs[tex_src[slot["index"]]]
                maps[key] = f"{im['w']}px {im['mime'].split('/')[-1]}" + (
                    f" uv{slot['texCoord']}" if slot.get("texCoord") else "")
        if not maps:
            maps["flat"] = ("emissive" if any(m.get("emissiveFactor", [0, 0, 0])) else "factor-only")
        mats.append({"name": m.get("name"), "maps": maps})
    return {
        "file": str(path), "mb": round(total / 1e6, 2), "tris": tris,
        "meshes": len(doc.get("meshes", [])), "materials": len(mats), "images": len(imgs),
        "image_mb": round(sum(i["kb"] for i in imgs) / 1024, 2),
        "by_class": dict(sorted(Counter(f"{i['class']} {i['mime'].split('/')[-1]}" for i in imgs).items())),
        "extensions": doc.get("extensionsUsed", []),
        "image_list": imgs, "material_maps": mats,
    }


if __name__ == "__main__":
    args = sys.argv[1:]
    out = None
    if "--json" in args:
        k = args.index("--json")
        out = args[k + 1]
        args = args[:k] + args[k + 2:]
    reps = [report(p) for p in args]
    for r in reps:
        print(f"\n== {r['file']}")
        print(f"   {r['mb']} MB | {r['tris']:,} tris | {r['meshes']} meshes | {r['materials']} materials | "
              f"{r['images']} images ({r['image_mb']} MB)")
        print(f"   images by class: {r['by_class']}")
        print(f"   extensions: {', '.join(r['extensions'])}")
    if out:
        Path(out).write_text(json.dumps(reps, indent=1))
