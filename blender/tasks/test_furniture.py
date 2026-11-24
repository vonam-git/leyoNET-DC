"""lib test (Plan v2): Arbeitstisch + 3 Notebooks (Level 1 / Admin-Laptop). Polycount, Overlay-
Liste, Front- und Turntable-Render.

blender -b -P blender/tasks/test_furniture.py
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bpy  # noqa: E402

import check_mesh  # noqa: E402
from lib import furniture, render  # noqa: E402

render.reset_scene()
desk = furniture.build_desk("desk_1")
nbs = []
for i, y in enumerate((-0.5, 0.0, 0.5)):
    nb = furniture.build_notebook(f"t1_notebook_{i + 1}")
    furniture.place_on_desk(nb, desk, 0.05, y, -math.pi / 2)   # Bildschirm zeigt nach -X
    nbs.append(nb)
bpy.context.view_layer.update()
ok, poly = check_mesh.report(render.RENDER_DIR / "test_furniture_polycount.json")
for nb in nbs:
    kids = [c.name for c in nb.children_recursive if "leyonet_overlay" in c]
    print(f"[furn] {nb.name}: type={nb['leyonet_type']} overlays={kids}")
objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
render.setup_lights(objs)
render.render_front("test_furniture", objs, res_long=1600, samples=32, front=(-1, 0, 0))
render.render_turntable("test_furniture", objs, frames=8, res=(960, 720), samples=12, elevation=0.5)
print("[furn] polycount ok:", ok)
