"""lib test: texture-set device materials (tint, UVs from MeshBuilder.finish):
server, switch, patch panel, 1U PDU, blank mounted in a 42U rack, front crop.
blender -b -P blender/tasks/test_device_pbr.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import bpy  # noqa: E402
from lib import devices, render  # noqa: E402

render.reset_scene()
rack = devices.build_rack_42he()
devices.mount(rack, devices.build_patchpanel_24(), 24)
devices.mount(rack, devices.build_switch_24(), 23)
devices.mount(rack, devices.build_server_1u(), 21)
devices.mount(rack, devices.build_pdu(style="1u"), 20)
devices.mount(rack, devices.build_blank(2), 18)
bpy.context.view_layer.update()
objs = [rack, *rack.children]
for o in objs:
    assert o.data.uv_layers.get("UVMap"), o.name
flat = sorted({m.name for o in objs for m in o.data.materials if "texset" not in m})
print("FLAT", flat)
render.setup_lights(objs, floor=True)
z0 = devices.u_bottom(rack, 17)
render.render_front("test_device_pbr", objs, res_long=1400, samples=32,
                    bbox=((-0.32, 0, z0), (0.32, 0, z0 + 9 * devices.U)), suffix="front_crop")
render.render_view("test_device_pbr", "persp", (0.9, -1.1, 1.6), (0.0, 0.3, 1.0), lens=35,
                   res=(1000, 1000), samples=32)
