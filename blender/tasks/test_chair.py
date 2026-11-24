"""lib test (Plan v3): Buerostuhl furniture.build_chair. Polycount, Front + Turntable.

blender -b -P blender/tasks/test_chair.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bpy  # noqa: E402

import check_mesh  # noqa: E402
from lib import furniture, render  # noqa: E402

render.reset_scene()
ch = furniture.build_chair("chair_1")
bpy.context.view_layer.update()
ok, poly = check_mesh.report(render.RENDER_DIR / "test_chair_polycount.json")
sit = bpy.data.objects["chair_1_sit"]
print("[chair] sit", tuple(round(v, 3) for v in sit.matrix_world.translation), "ok", ok)
objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
render.setup_lights(objs)
render.render_front("test_chair", objs, res_long=1200, samples=32, front=(0, 1, 0))
render.render_turntable("test_chair", objs, frames=4, res=(960, 960), samples=16, elevation=0.35)
