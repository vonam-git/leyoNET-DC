"""SMB server room: build, polycount (<= 300k), bake procedural textures,
4 PBR reference views, lightmap bake + export (bake.py), then re-import the
exported glb and render the same 4 views + front section + cut-away turntable
using ONLY what the file carries (albedo x lightmap + emission).

blender -b -P blender/tasks/room_smb.py
afterwards: the gltf-transform chain from assets/out/room_smb.bake.json ("optimize",
            = bake.OPTIMIZE_CMD: UASTC normals + ETC1S rest, Draco last)
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bpy  # noqa: E402

import check_mesh  # noqa: E402
from lib import bake, render, room  # noqa: E402

NAME = "room_smb"
LM_RES = {"room": 2048, "rack_1": 1024, "rack_2": 1024, "rack_3": 1024, "rack_4": 1024}
render.RENDER_DIR.mkdir(parents=True, exist_ok=True)


def dark_world():
    bpy.context.scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0


# 1. build + polycount gate
render.reset_scene()
dark_world()
built = room.build_room_smb()
groups, unbaked = built["groups"], built["unbaked"]
ok, poly = check_mesh.report(render.RENDER_DIR / f"{NAME}_polycount.json")
if not ok:
    print("ABORT: polycount over limit")
    sys.exit(1)

# 2. procedural -> textures (also used by all following renders and the bake)
opaque = [o for g in groups.values() for o in g]
bake.bake_all_procedural(opaque, bake.BUILD_DIR / NAME)

# 3. PBR reference renders (Cycles, full GI)
sc = bpy.context.scene
sc.cycles.max_bounces = 6
for view, (loc, tgt, lens) in room.VIEWS.items():
    render.render_view(NAME, f"pbr_{view}", loc, tgt, lens=lens, res=(1280, 720), samples=64)

# 4. lightmaps + export
path, manifest = bake.bake_and_export(NAME, groups, unbaked=unbaked, res=LM_RES, samples=128)
bpy.ops.wm.save_as_mainfile(filepath=str(render.RENDER_DIR / f"{NAME}.blend"))

# 5. verification on the exported file
render.reset_scene()
dark_world()
assert bake.preview_from_glb(path) > 0, "no lightmapped materials in export"
sc = bpy.context.scene
sc.cycles.max_bounces = 0
sc.cycles.transparent_max_bounces = 8
print("polycount of the exported file:")
check_mesh.report(render.RENDER_DIR / f"{NAME}_polycount_export.json")
for view, (loc, tgt, lens) in room.VIEWS.items():
    render.render_view(NAME, f"baked_{view}", loc, tgt, lens=lens, res=(1280, 720), samples=16)
objs = [o for o in sc.objects if o.type == "MESH"]
render.render_front(NAME, objs, res_long=1600, samples=16, clip_start=3.25)
walls = [(bpy.data.objects[n], v) for n, v in room.WALL_NORMALS.items()]
render.render_turntable(NAME, objs, frames=24, res=(960, 720), samples=12, cutaway=walls,
                        hide=[bpy.data.objects["ceiling"]], elevation=0.55)
print(f"DONE {path}")
