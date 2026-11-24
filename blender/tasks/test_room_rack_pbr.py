"""Test scene (Realismus-Regeln, Aufgabe 1): SMB room (concrete walls, 600 mm
raised floor, door, LED bands; cold-aisle containment only if room.CONTAINMENT) + ONE fully equipped 42U
rack (brushed steel housing). All materials ambientCG texture sets except
emissives / parts < 1 cm. Polycount, 3 PBR views (front, side, overview),
front + turntable, lightmap bake + export (bake.py), gltf-transform afterwards.

blender -b -P blender/tasks/test_room_rack_pbr.py
"""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bpy  # noqa: E402

import check_mesh  # noqa: E402
from lib import bake, devices, furniture, render, room, uvtools  # noqa: E402

NAME = "test_room_rack_pbr"
LM_RES = {"room": 1024, "rack_1": 1024, "desk_1": 512}
VIEWS = {   # name -> (location, target, lens)
    "front": ((2.72, 1.60, 1.10), (1.60, 1.60, 1.00), 14),     # from the cold aisle onto the rack front
    "side":  ((1.05, 3.90, 1.20), (1.05, 1.60, 1.00), 18),     # along the row onto the rack side panel
    "total": room.VIEWS["view_corner"],
}

render.reset_scene()
bpy.context.scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0

shell = room.build_room_shell()
tiles, perf, sub = room.build_raised_floor()
door, door_glass = room.build_door()
leds = [room.build_led_band(f"led_band_{i + 1}", x) for i, x in enumerate(room.LED_X)]
cont, cont_glass = room.build_cold_aisle_containment() if room.CONTAINMENT else (None, None)
rack = devices.build_rack_42he(name="rack_1")
rack.location = (room.RACK_FRONT_X, room.ROW_Y0 + 0.3, 0.0)
rack.rotation_euler = (0.0, 0.0, math.pi / 2)
devices.mount(rack, devices.build_pdu("r1_pdu_1u", style="1u", amps="2.4"), 1)
room._populate(rack, 1)       # patch panels, switches, servers, 0U PDUs, blanks in every free U
bpy.context.view_layer.update()
uvtools.box_project(door, 1.0)
for o in [x for x in (cont, *leds) if x]:
    uvtools.box_project_aligned(o, 1.0)
for o in [x for x in (door_glass, cont_glass) if x]:
    uvtools.box_project(o, 1.0)
parts = [x for x in (*shell.values(), tiles, perf, sub, door, *leds, cont, door_glass, cont_glass) if x]
for o in parts:
    room.bevel(o)
# Arbeitstisch an der rechten Wand mit 3 Notebooks (Plan v2: Level 1 + Admin-Laptop fuer die Konsole)
desk = furniture.build_desk("desk_1")
desk.location = (3.55, 1.85, 0.0)
notebooks = []
for i, y in enumerate((1.35, 1.85, 2.35)):
    nb = furniture.build_notebook(f"t1_notebook_{i + 1}")
    furniture.place_on_desk(nb, desk, 3.50, y, -math.pi / 2)    # Bildschirm Richtung Raum (-X)
    notebooks.append(nb)
bpy.context.view_layer.update()
desk_objs, desk_overlays = room.split_overlays([o for root in (desk, *notebooks) for o in room._descendants(root)])
rack_objs, overlays = room.split_overlays(room._descendants(rack))
overlays = overlays + desk_overlays
groups = {"room": [x for x in (*shell.values(), tiles, perf, sub, door, *leds, cont) if x], "rack_1": rack_objs,
          "desk_1": desk_objs}
unbaked = [x for x in (door_glass, cont_glass) if x] + overlays     # + device LEDs / ports / displays (no lightmap)

ok, poly = check_mesh.report(render.RENDER_DIR / f"{NAME}_polycount.json")
if not ok:
    sys.exit("ABORT: polycount over limit")

# material audit (Realismus-Regel 2)
audit = {}
for o in [*parts, *rack_objs, *desk_objs, *overlays]:
    for m in o.data.materials:
        audit[m.name] = dict(m["texset"]) if "texset" in m else "FLAT"
flat = sorted(k for k, v in audit.items() if v == "FLAT")
print("FLAT materials:", flat)

sc = bpy.context.scene
sc.cycles.max_bounces = 6
for view, (loc, tgt, lens) in VIEWS.items():
    render.render_view(NAME, f"pbr_{view}", loc, tgt, lens=lens, res=(1600, 900), samples=48)

path, manifest = bake.bake_and_export(NAME, groups, unbaked=unbaked, res=LM_RES, samples=64)

objs = [o for o in sc.objects if o.type == "MESH"]
render.render_front(NAME, [*rack_objs, *overlays], res_long=1600, samples=32,
                    front=render.front_axis(rack), isolate=True, studio=True)   # ISSUE-004
walls = [(bpy.data.objects[n], v) for n, v in room.WALL_NORMALS.items()]
render.render_turntable(NAME, objs, frames=8, res=(960, 720), samples=12, cutaway=walls,
                        hide=[bpy.data.objects["ceiling"]], elevation=0.55)
(render.RENDER_DIR / f"{NAME}_materials.json").write_text(json.dumps(audit, indent=1, default=list))
print(f"DONE {path} {path.stat().st_size / 1e6:.1f} MB")
