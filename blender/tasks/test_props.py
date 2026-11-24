"""lib test props.py: 3 patch bundles in a rack top section, extinguisher,
exit sign, carton. One render per prop group.
blender -b -P blender/tasks/test_props.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import bpy  # noqa: E402
from lib import devices, props, render  # noqa: E402

render.reset_scene()
rack = devices.build_rack_42he()
for u, kind in ((42, "pp"), (41, "sw"), (40, "pp"), (39, "sw"), (38, "pp"), (37, "sw")):
    devices.mount(rack, devices.build_patchpanel_24() if kind == "pp" else devices.build_switch_24(seed=u), u)
bundles = props.build_patch_bundles(rack)
for b in bundles:
    print("BUNDLE", b.name, b["cable_length_m"], "m ties", b["cable_ties"], "tris",
          sum(len(p.vertices) - 2 for p in b.data.polygons))
bpy.context.view_layer.update()
objs = [rack, *rack.children]
render.setup_lights(objs, floor=False)
z0 = devices.u_bottom(rack, 34)
render.render_front("test_props", objs, res_long=1200, samples=24,
                    bbox=((-0.30, 0, z0), (0.30, 0, devices.u_bottom(rack, 43) + 0.01)), suffix="bundles_front")
render.render_view("test_props", "bundles_persp", (-0.55, -0.55, 1.95), (-0.05, 0.1, 1.72), lens=40,
                   res=(1000, 800), samples=24)
for o in objs:
    o.hide_render = True
ext = props.build_fire_extinguisher(loc=(0, 0, 0))
sign = props.build_exit_sign(loc=(0.6, 0, 0.9))
sign.rotation_euler = (0, 0, 3.14159)   # face -y towards the camera
car = props.build_carton(loc=(-0.7, 0, 0), rot_z=0.3)
for o in (ext, sign, car):
    print("PROP", o.name, sum(len(p.vertices) - 2 for p in o.data.polygons), "tris",
          sorted({m.name for m in o.data.materials}))
ext.rotation_euler = (0, 0, 1.5708)   # face -y
render.setup_lights([ext, sign, car], floor=True)
render.render_view("test_props", "props", (0.0, -2.4, 1.1), (0.0, 0.0, 0.55), lens=40,
                   res=(1200, 800), samples=24)
