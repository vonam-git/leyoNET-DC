"""lib test: every ambientCG texture-set material (lib.textures.SETS) on a beveled
0.5 m block, UV0 in metres. Prints the derived roughness statistics.
Front view + short turntable.

blender -b -P blender/tasks/test_textures.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lib import render, room, textures, uvtools  # noqa: E402
from lib.devices import MeshBuilder  # noqa: E402

render.reset_scene()
objs = []
names = list(textures.SETS)
for i, name in enumerate(names):
    mat = textures.get(name)
    print(f"[tex] {name:28s} {dict(mat['texset'])}")
    col, row = i % 5, i // 5
    x0, z0 = col * 0.6, (2 - row) * 0.6
    mb = MeshBuilder(f"swatch_{name}")
    mb.box(x0, x0 + 0.5, 0.0, 0.1, z0, z0 + 0.5, name)
    o = mb.finish("test")
    uvtools.box_project(o, 1.0)
    room.bevel(o)
    objs.append(o)
render.setup_lights(objs, floor=False)
render.render_front("test_textures", objs, res_long=2000, samples=32)
render.render_turntable("test_textures", objs, frames=8, res=(640, 400), samples=12)
