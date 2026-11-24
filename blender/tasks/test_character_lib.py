"""lib test for character.py + bake.export_character_glb: Idle + Walking only,
one render. blender -b -P blender/tasks/test_character_lib.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import bpy  # noqa: E402
from lib import bake, character, render  # noqa: E402

SRC = Path(__file__).resolve().parents[2] / "assets" / "src" / "mixamo"
render.reset_scene()
arm, meshes, act, _ = character.import_fbx(SRC / "Idle.fbx")
character.add_clip(arm, act, "idle")
arm2, m2, act2, new2 = character.import_fbx(SRC / "Walking.fbx")
act2.use_fake_user = True
character.add_clip(arm, act2, "walking")
character.remove_objects(new2)
print("SLIM", character.slim_materials(meshes, bake.BUILD_DIR / "test_character_lib"))
print("DECI", character.decimate_to(meshes, 50_000))
hips = character.bone_prefix(arm) + ":Hips"
print("DRIFT walking", character.horizontal_drift(character.hips_world_track(arm, act2, hips)).length)
path, clips = bake.export_character_glb("test_character_lib", arm, meshes)
assert clips == ["idle", "walking"] or sorted(clips) == ["idle", "walking"], clips
arm.animation_data.action = bpy.data.actions["walking"]
render.setup_lights(meshes)
render.render_front("test_character_lib", meshes, res_long=800, samples=16)
