"""lib test: procedural floor (sponge rubber) + concrete swatches, 2 m each, so the
1 m / 2 m tiles repeat -> seams would be visible. Front view + turntable.

blender -b -P blender/tasks/test_room_materials.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bpy  # noqa: E402

from lib import procedural, render, uvtools  # noqa: E402
from lib.devices import MeshBuilder  # noqa: E402

render.reset_scene()
objs = []
for i, (mat, tile) in enumerate(((procedural.sponge_rubber(), 1.0), (procedural.concrete(), 2.0))):
    mb = MeshBuilder(f"swatch_{mat.name}")
    x0 = i * 2.2
    mb.box(x0, x0 + 2.0, 0.0, 0.05, 0.0, 2.0, "plastic_black")
    obj = mb.finish("test")
    obj.data.materials[0] = mat
    uvtools.box_project(obj, tile)
    objs.append(obj)
render.setup_lights(objs, floor=False)
render.render_front("test_room_materials", objs, res_long=2400, samples=32)
# 1:1-ish detail crops (20 cm) across the tile seam at x = 1.0 m (rubber) / 2.2 + 2.0 (concrete)
render.render_front("test_room_materials", objs, res_long=1000, samples=32, suffix="detail_rubber",
                    bbox=((0.9, -0.1, 0.9), (1.1, 0.0, 1.1)))
render.render_front("test_room_materials", objs, res_long=1000, samples=32, suffix="detail_concrete",
                    bbox=((3.0, -0.1, 0.9), (3.4, 0.0, 1.3)))
render.render_turntable("test_room_materials", objs, frames=8, res=(640, 360), samples=12)
