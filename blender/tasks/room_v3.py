"""Plan v3 Etappe 3: Raum v3 - leerer Serverraum 8 x 6 m mit Glasfront, Aussenbereich, 8 Rack-
Plaetzen, Tisch mit 3 Notebook-Plaetzen und Stuhl. Polycount, Material-Audit, Ansichten, Front
(Tisch + Stuhl) + Turntable, Lightmap-Bake + Export (bake.py) -> assets/out/room_v3.raw.glb,
Slots ins Manifest (room_v3.manifest.json). Danach OPTIMIZE_CMD aus room_v3.bake.json.

blender -b -P blender/tasks/room_v3.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bpy  # noqa: E402

import check_mesh  # noqa: E402
from lib import bake, render, room_v3  # noqa: E402

NAME = "room_v3"
LM_RES = {"room": 2048, "desk_1": 512, "outside": 512, "props": 512}

render.reset_scene()
bpy.context.scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
r = room_v3.build_room_v3()
bpy.context.view_layer.update()

ok, poly = check_mesh.report(render.RENDER_DIR / f"{NAME}_polycount.json")
if not ok:
    sys.exit("ABORT: polycount over limit")

audit = {}
for o in [o for g in r["groups"].values() for o in g] + [o for o in r["unbaked"] if o.type == "MESH"]:
    for m in o.data.materials:
        audit[m.name] = dict(m["texset"]) if "texset" in m else "FLAT"
print("FLAT materials:", sorted(k for k, v in audit.items() if v == "FLAT"))

sc = bpy.context.scene
sc.cycles.max_bounces = 6
for view, (loc, tgt, lens) in room_v3.VIEWS.items():
    render.render_view(NAME, f"pbr_{view}", loc, tgt, lens=lens, res=(1600, 900), samples=48)

path, manifest = bake.bake_and_export(NAME, r["groups"], unbaked=r["unbaked"], res=LM_RES, samples=64)

# Slots ins Raum-Manifest (Spiel: Einbau-Plaetze); Koordinaten glTF (x, z, -y), yaw um +Y
mf = Path(manifest["room_manifest"])
mf = mf if mf.is_absolute() else bake.ROOT / mf
data = json.loads(mf.read_text())
data["version"] = 3
data["slots"] = [{"node": s.name, "kind": s["leyonet_slot"], "index": int(s["leyonet_slot_index"]),
                  "row": s.get("leyonet_row", ""),
                  "pos": [round(s.location.x, 4), round(s.location.z, 4), round(-s.location.y, 4)],
                  "yaw": round(s.rotation_euler.z, 6),
                  **({"vorlage": s["leyonet_vorlage"]} if "leyonet_vorlage" in s else {})} for s in r["slots"]]
data["trays"] = room_v3.tray_manifest()
mf.write_text(json.dumps(data, indent=1))
print(f"[room_v3] {len(data['slots'])} Slots -> {mf.name}")

desk_objs = [o for o in r["groups"]["desk_1"]]
render.render_front(NAME, desk_objs, res_long=1600, samples=32, front=(0, -1, 0), isolate=True, studio=True)
objs = [o for o in sc.objects if o.type == "MESH" and o.name != "outside_sky"]
walls = [(r["shell"][n], v) for n, v in (("wall_front", (0, -1, 0)), ("wall_left", (-1, 0, 0)),
                                          ("wall_right", (1, 0, 0)))]
render.render_turntable(NAME, objs, frames=8, res=(960, 720), samples=12, cutaway=walls,
                        hide=[bpy.data.objects["ceiling"], r["sky"]], elevation=0.55)
(render.RENDER_DIR / f"{NAME}_materials.json").write_text(json.dumps(audit, indent=1, default=list))
print(f"DONE {path} {path.stat().st_size / 1e6:.1f} MB")
