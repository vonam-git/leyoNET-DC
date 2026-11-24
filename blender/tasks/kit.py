"""Plan v3 Etappe 2: Bausatz - je Geraetetyp EINE Vorlage (Rack 42 HE inkl. 2 PDU-0U, Switch,
Core-Switch, Patchpanel, Server, Router, Firewall, KVM, Blindplatten, Notebook). Das Spiel klont
sie zur Laufzeit (Kauf + Einbau). Polycount, Front + Turntable, Export via bake.export_kit
-> assets/out/kit.raw.glb + kit.kit.json, danach OPTIMIZE_CMD (kit.bake.json).

blender -b -P blender/tasks/kit.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bpy  # noqa: E402

import check_mesh  # noqa: E402
from lib import bake, devices, furniture, render  # noqa: E402

NAME = "kit"
render.reset_scene()

rack = devices.build_rack_42he(name="kit_rack")
for side in (-1, 1):
    devices.mount_pdu_0u(rack, devices.build_pdu(f"kit_rack_pdu_0u_{'L' if side < 0 else 'R'}", style="0u",
                                                 amps="0.0"), side=side)
units = [
    devices.build_switch_24("kit_switch", seed=41),
    devices.build_switch_24("kit_coreswitch", seed=37, core=True),
    devices.build_patchpanel_24("kit_patchpanel"),
    devices.build_server_1u("kit_server", seed=101),
    devices.build_router_1u("kit_router"),
    devices.build_firewall_1u("kit_firewall"),
    devices.build_kvm_1u("kit_kvm"),
    devices.build_blank(1, name="kit_blank_1u"),
    devices.build_blank(2, name="kit_blank_2u"),
    devices.build_pdu("kit_pdu_1u", style="1u", amps="0.0"),
]
bench = furniture.build_bench("kit_bench")             # Plan v4 D: Pult - Gestell, Steckdosenleiste, Tischdose
desk_units = [devices.build_desk_strip("kit_desk_strip"), devices.build_table_outlet("kit_table_outlet")]
nb = furniture.build_notebook("kit_notebook")

# Aufstellung nur fuer die Renders (das Spiel setzt die Transformation jeder Kopie selbst)
for k, d in enumerate(units):
    d.location = (0.9, 0.0, 0.15 + k * 0.12)
nb.location = (1.6, 0.0, 0.6)
bench.location = (1.6, 0.0, 1.0)
for k, d in enumerate(desk_units):
    d.location = (1.6, 0.0, 1.5 + k * 0.15)
bpy.context.view_layer.update()

ok, poly = check_mesh.report(render.RENDER_DIR / f"{NAME}_polycount.json")
if not ok:
    sys.exit("ABORT: polycount over limit")

meta = {"kit_rack": {"z_u1": rack["z_u1"], "y_front_rail": rack["y_front_rail"], "y_rear_rail": rack["y_rear_rail"],
                     "u": devices.U, "slots": int(rack["he"]), "width": rack["width"], "height": rack["height"],
                     "depth": 1.0,
                     # Einbau-Ursprung von HE 1 im Rack-Lokalraum (glTF: x, z, -y) - Geraet: + (u-1)*u auf y
                     "mount_gltf": [0.0, rack["z_u1"], -rack["y_front_rail"]]}}
meta["kit_bench"] = {"z_u1": bench["z_u1"], "y_front_rail": bench["y_front_rail"], "y_rear_rail": bench["y_rear_rail"],
                     "u": devices.U, "slots": int(bench["he"]), "width": bench["width"], "height": bench["height"],
                     "depth": float(bench["depth"]), "mount_gltf": [0.0, bench["z_u1"], -bench["y_front_rail"]]}
for d in [*units, *desk_units]:
    meta[d.name] = {"depth": float(d.get("depth", 0.0))}
meta["kit_notebook"] = {"footprint": [furniture.NB_W, furniture.NB_D]}

objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
render.setup_lights(objs)
render.render_front(NAME, objs, res_long=1600, samples=32, front=(0, -1, 0))
render.render_turntable(NAME, objs, frames=8, res=(960, 720), samples=12, elevation=0.4)

templates = [rack, *units, nb, bench, *desk_units]
for t in templates:   # Vorlagen fuer den Export in den Ursprung (Spiel klont + positioniert)
    t.location = (0.0, 0.0, 0.0)
bpy.context.view_layer.update()
path, kit = bake.export_kit(NAME, templates, meta)
print(f"DONE {path} {path.stat().st_size / 1e6:.1f} MB, {len(kit['templates'])} Vorlagen")
