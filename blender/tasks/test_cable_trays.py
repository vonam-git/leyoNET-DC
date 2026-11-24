"""lib test (Ref-Vergleich Raum v3): Kabeltrassen room_v3.build_cable_trays + Abgangskaesten props.build_power_box. Polycount, Front + Turntable.

blender -b -P blender/tasks/test_cable_trays.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bpy  # noqa: E402

import check_mesh  # noqa: E402
from lib import props, render, room, room_v3  # noqa: E402

render.reset_scene()
tray = room_v3.build_cable_trays()
room.bevel(tray)
for r, (x, z) in room_v3.power_taps().items():
    room.bevel(props.build_power_box((x, -z), room_v3.H, name=f"power_box_{r.lower()}"), width=0.0005, segments=2)
bpy.context.view_layer.update()
ok, poly = check_mesh.report(render.RENDER_DIR / "test_cable_trays_polycount.json")
objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
print("[trays]", [(o.name, len(o.data.polygons)) for o in objs], "ok", ok)
render.setup_lights(objs)
render.render_front("test_cable_trays", objs, res_long=1400, samples=24, front=(0, -1, 0))
render.render_turntable("test_cable_trays", objs, frames=4, res=(1200, 700), samples=12, elevation=0.5)
