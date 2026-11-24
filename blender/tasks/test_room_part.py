"""lib test: one room part alone (front view + short turntable + polycount).

blender -b -P blender/tasks/test_room_part.py -- shell|door|led|containment|floor|racks
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import check_mesh  # noqa: E402
from lib import render, room  # noqa: E402

which = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "door"
render.reset_scene()
if which == "shell":
    objs = list(room.build_room_shell().values())
elif which == "door":
    objs = list(room.build_door())
elif which == "led":
    objs = [room.build_led_band("led_band_test", 0.0, 0.0, 1.2, 0.5)]
elif which == "containment":
    objs = list(room.build_cold_aisle_containment())
elif which == "floor":
    objs = list(room.build_raised_floor())
    for o in objs:
        room.bevel(o)
elif which == "racks":
    objs = room.build_racks()
    objs = [o for r in objs for o in room._descendants(r)]
else:
    raise SystemExit(f"unknown part {which}")
name = f"test_room_{which}"
render.RENDER_DIR.mkdir(parents=True, exist_ok=True)
ok, _ = check_mesh.report(render.RENDER_DIR / f"{name}_polycount.json")
render.setup_lights(objs)
render.render_front(name, objs, res_long=1400, samples=16)
render.render_turntable(name, objs, frames=8, res=(640, 480), samples=8)
sys.exit(0 if ok else 1)
