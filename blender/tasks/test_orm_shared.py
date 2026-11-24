"""lib test (Run C): shared ORM per ambientCG asset + per-material Math-Multiply
factors. 4 swatches (Metal027 x2, Metal009, wear material), probe glTF export to
a temp file (NOT an asset) to verify roughnessFactor / metallicFactor and image
sharing. Front view + short turntable.

blender -b -P blender/tasks/test_orm_shared.py -- <probe.glb>
"""
import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bpy  # noqa: E402

from lib import render, room, textures, uvtools  # noqa: E402
from lib.devices import MeshBuilder  # noqa: E402

probe = Path(sys.argv[sys.argv.index("--") + 1])
NAMES = ["rack_black", "device_dark", "device_silver", "brushed_steel_fingerprints"]

render.reset_scene()
objs = []
for i, name in enumerate(NAMES):
    mat = textures.get(name)
    print(f"[orm] {name:28s} {dict(mat['texset'])}")
    mb = MeshBuilder(f"swatch_{name}")
    x0 = i * 0.6
    mb.box(x0, x0 + 0.5, 0.0, 0.1, 0.0, 0.5, name)
    o = mb.finish("test")
    uvtools.box_project(o, 1.0)
    room.bevel(o)
    objs.append(o)

bpy.ops.object.select_all(action="DESELECT")
for o in objs:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(probe), export_format="GLB", use_selection=True,
                          export_image_format="JPEG", export_apply=True)
d = probe.read_bytes()
doc = json.loads(d[20:20 + struct.unpack("<I", d[12:16])[0]])
ok = True
for m in doc["materials"]:
    pbr = m["pbrMetallicRoughness"]
    tex = pbr.get("metallicRoughnessTexture", {}).get("index")
    img = doc["images"][doc["textures"][tex]["source"]]["name"] if tex is not None else None
    want = dict(bpy.data.materials[m["name"]]["texset"])
    rf, mf = pbr.get("roughnessFactor", 1.0), pbr.get("metallicFactor", 1.0)
    good = img is not None and abs(rf - want["rough_factor"]) < 1e-3 and abs(mf - want["metal_factor"]) < 1e-3
    ok &= good
    print(f"[orm] glTF {m['name']:28s} ORM={img} rF={rf:.4f} mF={mf} -> {'OK' if good else 'MISMATCH'}")
print(f"[orm] images {len(doc['images'])}: {[i['name'] for i in doc['images']]}")
print("[orm] RESULT", "OK" if ok else "FAIL")

render.setup_lights(objs, floor=False)
render.render_front("test_orm_shared", objs, res_long=1600, samples=32)
render.render_turntable("test_orm_shared", objs, frames=8, res=(640, 400), samples=12)
