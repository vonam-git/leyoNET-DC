"""Draw Calls (Plan v4): Toenungsfaktoren der Materialien mit eigener Albedo-Kopie (`<name>_Color`, textures._recolor) ->
game/src/tints.json. Das Spiel (unify.js) nimmt damit die gemeinsame Textur des ambientCG-Sets und rechnet die Toenung in
die Vertexfarben. Tafel mit allen getoenten Materialien als Render (Front + Turntable), Polycount.

blender -b -P blender/tasks/tints.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bpy  # noqa: E402

import check_mesh  # noqa: E402
from lib import render, room, textures  # noqa: E402
from lib.devices import MeshBuilder  # noqa: E402

render.reset_scene()
out = {}
for name, d in sorted(textures.SETS.items()):
    if not d.get("color") or d.get("opacity"):
        continue
    size = d.get("size", textures.SIZE_DEFAULT)
    img = textures._load(textures._sized(d["asset"], "Color", size), "sRGB")
    tint = textures._tint(img, d["color"])
    if max(tint) > 1.0:
        out[name] = {"map": f"{d['asset']}_{size}_Color", "tint": [round(t, 4) for t in tint]}
dst = Path(__file__).resolve().parents[2] / "game" / "src" / "tints.json"
dst.write_text(json.dumps(out, indent=1) + "\n")
print(f"[tints] {len(out)} Materialien -> {dst}")

mb = MeshBuilder("tint_board")
for k, name in enumerate(sorted(out)):
    x, z = (k % 6) * 0.14, (k // 6) * 0.14
    mb.box(x, x + 0.12, 0.0, 0.02, z, z + 0.12, name)
board = mb.finish("room")
room.bevel(board, width=0.0005, segments=2)
bpy.context.view_layer.update()
ok, poly = check_mesh.report(render.RENDER_DIR / "tints_polycount.json")
render.setup_lights([board])
render.render_front("tints", [board], res_long=900, samples=16, front=(0, -1, 0), isolate=True, studio=True)
render.render_turntable("tints", [board], frames=4, res=(600, 400), samples=8)
