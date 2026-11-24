"""lib test (Plan v4 I): Wandbildschirm + Lichtschalter (props.build_wall_display / build_light_switch). Polycount,
Front + Turntable.

blender -b -P blender/tasks/test_wall_props.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bpy  # noqa: E402

import check_mesh  # noqa: E402
from lib import props, render, room  # noqa: E402

render.reset_scene()
body, screen = props.build_wall_display(loc=(0.0, 0.0, 1.55))
switch = props.build_light_switch(loc=(0.0, 2.0, 1.10))
for o in (body, switch):
    room.bevel(o, width=0.0005, segments=2)
bpy.context.view_layer.update()
ok, poly = check_mesh.report(render.RENDER_DIR / "test_wall_props_polycount.json")
objs = [body, screen, switch]
print("[wall]", [(o.name, len(o.data.polygons)) for o in objs], "ok", ok)
render.setup_lights(objs)
render.render_front("test_wall_props", [body, screen], res_long=1400, samples=24, front=(-1, 0, 0), isolate=True, studio=True)
render.render_front("test_wall_props", [switch], res_long=900, samples=24, front=(0, 1, 0), isolate=True, studio=True, suffix="switch")
render.render_turntable("test_wall_props", [body, screen], frames=4, res=(1000, 700), samples=12)
