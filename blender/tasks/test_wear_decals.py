"""lib test (Realismus-Regel 4): wear decals of every device type.
Per type: front view with grazing studio light (roughness differences become visible)
and a false-colour map of the roughness delta (orm - orm_base) for checking placement /
strength. Turntable of the switch.

blender -b -P blender/tasks/test_wear_decals.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

from lib import devices, render, retrofit  # noqa: E402

BUILD = {
    "server_1u": lambda: devices.build_server_1u("server_1u", seed=3),
    "switch_24": lambda: devices.build_switch_24("switch_24", seed=41),
    "patchpanel_24": lambda: devices.build_patchpanel_24("patchpanel_24"),
    "pdu_1u": lambda: devices.build_pdu("pdu_1u", style="1u", amps="2.4"),
    "pdu_0u": lambda: devices.build_pdu("pdu_0u", style="0u", amps="6.8"),
    "blank_1u": lambda: devices.build_blank(1, "blank_1u"),
}
OUT = render.RENDER_DIR / "test_wear_decals"
OUT.mkdir(parents=True, exist_ok=True)


def load(path):
    img = bpy.data.images.load(str(path), check_existing=False)
    img.colorspace_settings.name = "Non-Color"
    a = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    a = a.reshape(img.size[1], img.size[0], 4)
    bpy.data.images.remove(img)
    return a


summary = {}
for kind, fn in BUILD.items():
    render.reset_scene()
    dev = fn()
    bpy.context.view_layer.update()
    t = dev["leyonet_type"]
    p = retrofit._paths(t)
    d = load(p["orm"])[..., 1] - load(p["orm_base"])[..., 1]
    info = json.loads((retrofit.BUILD / f"{t}.json").read_text())
    n = len(retrofit.wear_spec(t))
    summary[t] = {"decals": n, "delta_min": round(float(d.min()), 3), "delta_max": round(float(d.max()), 3),
                  "touched_frac": round(float((np.abs(d) > 0.005).mean()), 3)}
    print(f"[wear] {t}: {summary[t]}")
    assert n <= retrofit.WEAR_MAX, f"{t}: more than {retrofit.WEAR_MAX} decals"
    assert max(abs(d.min()), abs(d.max())) <= retrofit.WEAR_CAP + 1.5 / 255, f"{t}: delta above cap (8-bit tolerance)"
    # false colour delta map: red = rougher, blue = smoother, grey = unchanged
    h, w = d.shape
    viz = np.ones((h, w, 4), dtype=np.float32)
    s = np.clip(d / retrofit.WEAR_CAP, -1, 1)
    viz[..., 0] = 0.5 + 0.5 * np.clip(s, 0, 1)
    viz[..., 1] = 0.5 - 0.5 * np.abs(s)
    viz[..., 2] = 0.5 + 0.5 * np.clip(-s, 0, 1)
    img = bpy.data.images.new(f"{t}_wear_viz", w, h, alpha=False)
    img.pixels.foreach_set(viz.ravel())
    img.filepath_raw = str(OUT / f"{t}_delta.png")
    img.file_format = "PNG"
    img.save()
    objs = [dev, *dev.children]
    render.render_front(f"test_wear_{kind}", objs, res_long=2000, samples=32, studio=True,
                        out_dir=OUT)
    if kind == "switch_24":
        render.setup_lights(objs, floor=False)
        render.render_turntable("test_wear_switch_24", objs, frames=8, res=(960, 480), samples=12)
(OUT / "summary.json").write_text(json.dumps(summary, indent=1))
print("[wear] done", OUT)
