"""lib test (Devices-Retrofit): ONE device type, baked panel textures + overlays.
Prints bake stats, overlay names, tris (low + overlays) and renders a close front
view + turntable.

blender -b -P blender/tasks/test_retrofit_device.py -- <type>   (switch_24 default)
types: server_1u switch_24 patchpanel_24 pdu_1u pdu_0u blank_1u blank_2u router_1u firewall_1u
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bpy  # noqa: E402

from lib import devices, render, retrofit  # noqa: E402

BUILD = {
    "server_1u": lambda: devices.build_server_1u("server_1u", seed=3),
    "switch_24": lambda: devices.build_switch_24("switch_24", seed=41),
    "patchpanel_24": lambda: devices.build_patchpanel_24("patchpanel_24"),
    "pdu_1u": lambda: devices.build_pdu("pdu_1u", style="1u", amps="2.4"),
    "pdu_0u": lambda: devices.build_pdu("pdu_0u", style="0u", amps="6.8"),
    "blank_1u": lambda: devices.build_blank(1, "blank_1u"),
    "blank_2u": lambda: devices.build_blank(2, "blank_2u"),
    "router_1u": lambda: devices.build_router_1u("router_1u"),
    "firewall_1u": lambda: devices.build_firewall_1u("firewall_1u"),
    "kvm_1u": lambda: devices.build_kvm_1u("kvm_1u"),
}
kind = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "switch_24"

render.reset_scene()
dev = BUILD[kind]()
bpy.context.view_layer.update()
kids = [c for c in dev.children]
dg = bpy.context.evaluated_depsgraph_get()


def tris(o):
    ev = o.evaluated_get(dg)
    me = ev.to_mesh()
    n = sum(len(p.vertices) - 2 for p in me.polygons)
    ev.to_mesh_clear()
    return n


t_low, t_ov = tris(dev), sum(tris(c) for c in kids)
by = {}
for c in kids:
    by.setdefault(c["leyonet_overlay"], []).append(c.name)
print(f"[retro] {dev.name} type={dev['leyonet_type']} tris low {t_low} + overlays {t_ov} = {t_low + t_ov}")
for k, v in by.items():
    print(f"[retro] {k:7s} {len(v):3d}: {', '.join(sorted(v)[:6])}{' ...' if len(v) > 6 else ''}")
print(f"[retro] materials: {[m.name for m in dev.data.materials]}")
meta = retrofit.BUILD / f"{dev['leyonet_type']}.json"
print(f"[retro] bake meta: {meta.read_text().strip()[:400]}")
objs = [dev, *kids]
render.setup_lights(objs, floor=False)
render.render_front(f"test_retrofit_{kind}", objs, res_long=2400, samples=32)
render.render_turntable(f"test_retrofit_{kind}", objs, frames=8, res=(960, 480), samples=12)
