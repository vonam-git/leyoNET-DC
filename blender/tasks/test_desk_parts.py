"""lib test (Plan v4 D): grosses Pult, 19-Zoll-Tischgestell, Steckdosenleiste, Tischdose, 1-HE-PDU (Buchsen), Energiesaeule,
Sprinklerrohr. Polycount, Front + Turntable.

blender -b -P blender/tasks/test_desk_parts.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import math  # noqa: E402

import bpy  # noqa: E402

import check_mesh  # noqa: E402
from lib import devices, furniture, props, render, room, room_v3  # noqa: E402

render.reset_scene()
D = room_v3.DESK
desk = furniture.build_desk("desk_1", length=D["length"], depth=D["depth"])
desk.location = (D["x"], D["y"], 0.0)
desk.rotation_euler = (0, 0, math.pi / 2)
top = furniture.DESK_H
bench = furniture.build_bench("bench_1")
bench.location = (*room_v3.BENCH, top)
outlet = devices.build_table_outlet()
outlet.location = (*room_v3.DESK_OUTLET, top)
strip = devices.build_desk_strip()
strip.location = (*room_v3.DESK_STRIP, top)
pdu = devices.build_pdu("pdu_1u", style="1u", amps="0.0")
sw = devices.build_switch_24("switch_24", seed=1)
for d, u in ((pdu, 1), (sw, 3)):
    d.location = (room_v3.BENCH[0], room_v3.BENCH[1] + bench["y_front_rail"], top + bench["z_u1"] + (u - 1) * devices.U)
for k, x in enumerate(room_v3.NB_X):
    nb = furniture.build_notebook(f"nb_{k + 1}")
    nb.location = (x, D["y"] - 0.10, top)
pole = props.build_service_pole(room_v3.POLE, z0=top, z1=3.0)
room.bevel(pole, width=0.0005, segments=2)
spr = props.build_sprinkler(5.6, 3.6, 6.0)
bpy.context.view_layer.update()
ok, poly = check_mesh.report(render.RENDER_DIR / "test_desk_parts_polycount.json")
objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
ports = {d.name: sorted(c["leyonet_port"] for c in d.children if c.get("leyonet_overlay") == "port") for d in (strip, outlet, pdu)}
print("[desk]", ports, "ok", ok)
assert len(ports["desk_strip"]) == 8 and len(ports["table_outlet"]) == 8 and len(ports["pdu_1u"]) == 8
render.setup_lights(objs)
desk_objs = [o for o in objs if not o.name.startswith(("service_pole", "sprinkler"))]
render.render_front("test_desk_parts", desk_objs, res_long=1800, samples=32, front=(0, -1, 0), isolate=True, studio=True)
render.render_view("test_desk_parts", "view", (6.2, 3.1, 1.6), (6.2, 5.0, 0.85), lens=24, res=(1600, 900), samples=32)
render.render_view("test_desk_parts", "rear", (5.5, 6.6, 1.6), (6.3, 4.9, 0.85), lens=24, res=(1600, 900), samples=24)
render.render_turntable("test_desk_parts", objs, frames=4, res=(1000, 700), samples=12)
