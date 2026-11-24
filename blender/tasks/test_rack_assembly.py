"""Rack assembly test: 42U rack with patch panels, switches, servers, PDUs.
Geometric slot check, polycount report, front view + turntable.

blender -b -P blender/tasks/test_rack_assembly.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bpy  # noqa: E402

import check_mesh  # noqa: E402
from lib import devices, render  # noqa: E402

NAME = "test_rack_assembly"

render.reset_scene()
rack = devices.build_rack_42he()

layout = [  # (U, builder)
    (42, lambda: devices.build_patchpanel_24("patchpanel_A")),
    (41, lambda: devices.build_switch_24("switch_A", seed=1)),
    (40, lambda: devices.build_patchpanel_24("patchpanel_B")),
    (39, lambda: devices.build_switch_24("switch_B", seed=2)),
    # U38 intentionally empty (rail holes must be visible)
    *[(37 - i, (lambda i=i: devices.build_server_1u(f"server_{i + 1:02d}", seed=i))) for i in range(12)],
    # U14..U25 empty
    (2, lambda: devices.build_pdu("pdu_1u_B", style="1u", amps="2.7")),
    (1, lambda: devices.build_pdu("pdu_1u_A", style="1u", amps="4.1")),
]
for u, build in layout:
    devices.mount(rack, build(), u)
devices.mount_pdu_0u(rack, devices.build_pdu("pdu_0u_R", style="0u", amps="6.8"), side=1)

# geometric slot check
render.RENDER_DIR.mkdir(parents=True, exist_ok=True)
rows = devices.verify_mounts(rack)
print("\n=== HE slot check " + "=" * 43)
for r in rows:
    print(f"{r['device']:<16}{r['u']:<6} slot {r['slot_mm'][0]:8.2f}..{r['slot_mm'][1]:8.2f} mm"
          f"  panel {r['panel_mm'][0]:8.2f}..{r['panel_mm'][1]:8.2f} mm"
          f"  body {r['body_w_mm']:5.1f} mm  {'OK' if r['ok'] else 'FAIL ' + '; '.join(r['issues'])}")
slots_ok = all(r["ok"] for r in rows)
print(f"SLOT RESULT: {'PASS' if slots_ok else 'FAIL'} ({len(rows)} devices, occupied "
      f"{sum(rack['slots'])}/42 U)\n")
(render.RENDER_DIR / f"{NAME}_slots.json").write_text(json.dumps(rows, indent=2))

poly_ok, _ = check_mesh.report(render.RENDER_DIR / f"{NAME}_polycount.json")
bpy.ops.wm.save_as_mainfile(filepath=str(render.RENDER_DIR / f"{NAME}.blend"))

objs = [rack, *rack.children]
render.setup_lights([rack])
render.render_front(NAME, objs, res_long=3600, samples=48)
render.render_turntable(NAME, objs, frames=24, res=(540, 720), samples=24)
sys.exit(0 if (slots_ok and poly_ok) else 1)
