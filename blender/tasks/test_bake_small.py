"""lib test for bake.py on a mini room (2.5 x 2.5 x 2.5 m): ambientCG texture sets,
raised floor incl. perforated tiles, door, 1 LED band, 1 box, 2 mm bevels.
Lightmap bake, export + lightmap injection, re-import + baked-only render.

blender -b -P blender/tasks/test_bake_small.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bpy  # noqa: E402

import check_mesh  # noqa: E402
from lib import bake, render, room, uvtools  # noqa: E402
from lib.devices import MeshBuilder  # noqa: E402

NAME = "test_bake_small"
render.reset_scene()
bpy.context.scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
shell = room.build_room_shell(2.5, 2.5, 2.5, door=(1.2, 2.1, 2.0))
tiles, perf, sub = room.build_raised_floor(2.5, 2.5, origin=(0.1, 0.1),
                                           perforated=((0.7, 1.3), (0.7, 1.9)),
                                           worn=((1.3, 2.5), (0.0, 0.7)))
door, glass = room.build_door(1.2, 2.1, 2.0)
led = room.build_led_band("led_band_1", 1.25, 0.4, 2.1, 2.5)
mb = MeshBuilder("box")
mb.box(0.15, 0.65, 1.3, 2.2, 0.0, 1.6, "painted_steel")
box = mb.finish("room")
uvtools.box_project(door, 1.0)
uvtools.box_project(glass, 1.0)
uvtools.box_project(box, 1.0)
uvtools.box_project_aligned(led, 1.0)
parts = [*shell.values(), tiles, perf, sub, door, led, box, glass]
for o in parts:
    room.bevel(o)
groups = {"room": [o for o in parts if o is not glass]}
check_mesh.report()

path, manifest = bake.bake_and_export(NAME, groups, unbaked=[glass], res={"room": 512}, samples=64)

# verify: re-import the exported file and render only what it carries
render.reset_scene()
bpy.context.scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
assert bake.preview_from_glb(path) > 0, "no lightmapped materials in export"
sc = bpy.context.scene
sc.cycles.max_bounces = 0
sc.cycles.transparent_max_bounces = 8
objs = [o for o in sc.objects if o.type == "MESH"]
render.render_view(NAME, "baked_view", (2.2, 0.3, 1.6), (0.6, 2.0, 0.5), lens=16, res=(960, 540), samples=16)
render.render_front(NAME, objs, res_long=1000, samples=16, clip_start=3.25)
walls = [(bpy.data.objects[n], v) for n, v in room.WALL_NORMALS.items()]
render.render_turntable(NAME, objs, frames=8, res=(640, 480), samples=8, cutaway=walls,
                        hide=[bpy.data.objects["ceiling"]])
