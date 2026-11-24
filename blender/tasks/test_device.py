"""Single-device lib test: build ONE device, front render + short turntable,
polycount report, .blend saved for check_mesh.py.

blender -b -P blender/tasks/test_device.py -- server_1u|switch_24|patchpanel_24|pdu_1u|pdu_0u|rack_42he
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bpy  # noqa: E402

import check_mesh  # noqa: E402
from lib import devices, render  # noqa: E402

BUILDERS = {
    "server_1u": lambda: devices.build_server_1u(),
    "switch_24": lambda: devices.build_switch_24(),
    "patchpanel_24": lambda: devices.build_patchpanel_24(),
    "pdu_1u": lambda: devices.build_pdu(name="pdu_1u", style="1u"),
    "pdu_0u": lambda: devices.build_pdu(name="pdu_0u", style="0u"),
    "rack_42he": lambda: devices.build_rack_42he(),
    "blank_2u": lambda: devices.build_blank(2),
}

which = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "server_1u"
render.reset_scene()
obj = BUILDERS[which]()
render.RENDER_DIR.mkdir(parents=True, exist_ok=True)
name = f"test_{which}"
ok, _ = check_mesh.report(render.RENDER_DIR / f"{name}_polycount.json")
bpy.ops.wm.save_as_mainfile(filepath=str(render.RENDER_DIR / f"{name}.blend"))
render.setup_lights([obj])
render.render_front(name, [obj], res_long=1800 if which != "rack_42he" else 2400, samples=48)
render.render_turntable(name, [obj], frames=12, res=(640, 480) if which != "rack_42he" and which != "pdu_0u" else (480, 720), samples=16)
sys.exit(0 if ok else 1)
