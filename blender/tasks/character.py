"""Final character: all Mixamo FBX (same skeleton) -> ONE assets/out/character.glb.

* mesh only from Idle.fbx, every other file contributes its clip (NLA track)
* clip names = file stem in snake_case ('Crouched Walking.fbx' -> crouched_walking)
* walking / running / crouched_walking forced in place (root XY drift removed)
* renders: character_animations.png (one tile per clip) + front + turntable

blender -b -P blender/tasks/character.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bpy  # noqa: E402

import check_mesh  # noqa: E402
from lib import bake, character, render  # noqa: E402

NAME = "character"
ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "assets" / "src" / "mixamo"
MESH_FILE = "Idle.fbx"
IN_PLACE = {"walking", "running", "crouched_walking"}
IN_PLACE_TOL = 0.05          # m of start->end horizontal root drift allowed
MAX_MB = 8.0
TILE_BBOX = ((-0.95, 0, -0.05), (0.95, 0, 2.4))

render.reset_scene()
report = {"clips": {}, "issues": []}

# 1) mesh + armature from Idle -------------------------------------------------------
arm, meshes, act, _ = character.import_fbx(SRC / MESH_FILE)
arm.name = character.ARMATURE_NAME
arm.data.name = character.ARMATURE_NAME
prefix = character.bone_prefix(arm)
bones = [b.name for b in arm.data.bones]
hips = f"{prefix}:Hips"
arm["leyonet_kind"] = "character"
character.add_clip(arm, act, character.clip_name(MESH_FILE))
report["clips"][character.clip_name(MESH_FILE)] = {"file": MESH_FILE, "armature": "Armature"}

# 2+3) every other file: same skeleton? -> clip onto the main armature, drop the rest -
for f in sorted(SRC.glob("*.fbx")):
    if f.name == MESH_FILE:
        continue
    name = character.clip_name(f)
    a2, m2, act2, new = character.import_fbx(f)
    info = {"file": f.name, "armature": a2.name.split(".")[0]}
    if act2 is None:
        report["issues"].append(f"{f.name}: no animation")
        character.remove_objects(new)
        continue
    renamed = character.unify_bone_names(a2, act2, prefix)
    if renamed:
        info["bones_renamed"] = renamed
    if [b.name for b in a2.data.bones] != bones:
        report["issues"].append(f"{f.name}: skeleton differs from {MESH_FILE} - skipped")
        character.remove_objects(new)
        continue
    act2.use_fake_user = True
    character.add_clip(arm, act2, name)
    character.remove_objects(new)          # armature + mesh duplicates
    report["clips"][name] = info
    print(f"[character] clip {name} <- {f.name}", flush=True)

leftover = [o.name for o in bpy.data.objects if o.type in {"ARMATURE", "MESH"}
            and o is not arm and o not in meshes]
assert not leftover, f"duplicates left: {leftover}"

# 5) in-place check / fix --------------------------------------------------------------
for name, info in report["clips"].items():
    action = bpy.data.actions[name]
    pts = character.hips_world_track(arm, action, hips)
    drift = character.horizontal_drift(pts).length
    info["frames"] = [int(action.frame_range[0]), int(action.frame_range[1])]
    info["root_drift_m"] = round(drift, 3)
    if name in IN_PLACE:
        if drift > IN_PLACE_TOL:
            before, residual, after = character.make_in_place(arm, action, hips)
            info["in_place_fixed"] = {"drift_before_m": round(before, 3),
                                      "drift_after_m": round(after, 4),
                                      "xy_range_after_m": round(residual, 3)}
            assert after < IN_PLACE_TOL, f"{name}: still drifting {after:.3f} m"
            info["root_drift_m"] = round(after, 4)
        info["in_place"] = True
    elif drift > 0.25:
        report["issues"].append(f"{name}: root motion {drift:.2f} m (not in IN_PLACE list, kept)")

# 6) textures, polycount, export -------------------------------------------------------
bpy.context.scene.render.image_settings.compression = 100   # max lossless PNG
report["materials"] = character.slim_materials(meshes, bake.BUILD_DIR / NAME, base=2048, normal=2048,
                                               rough=512, hair=512)
report["decimate"] = character.decimate_to(meshes, check_mesh.LIMIT_DEVICE)
ok, poly = check_mesh.report(str(render.RENDER_DIR / f"{NAME}_polycount.json"))
assert ok, "polycount over limit"

path, clips = bake.export_character_glb(NAME, arm, meshes)
size_mb = path.stat().st_size / 1e6
report["glb"] = {"path": str(path.relative_to(ROOT)), "size_mb": round(size_mb, 2), "clips": clips}
missing = sorted(set(report["clips"]) - set(clips))
extra = sorted(set(clips) - set(report["clips"]))
if missing or extra:
    report["issues"].append(f"glb clip mismatch missing={missing} extra={extra}")
if size_mb > MAX_MB:
    report["issues"].append(f"glb {size_mb:.2f} MB > {MAX_MB} MB")

# 7) renders ----------------------------------------------------------------------------
ad = arm.animation_data
for t in ad.nla_tracks:
    t.mute = True
render.setup_lights(meshes)
sc = bpy.context.scene

txt_mat = bpy.data.materials.new("label")
txt_mat.use_nodes = True
b = txt_mat.node_tree.nodes["Principled BSDF"]
b.inputs["Base Color"].default_value = (0.02, 0.02, 0.02, 1)
b.inputs["Emission Color"].default_value = (1, 1, 1, 1)
b.inputs["Emission Strength"].default_value = 1.0
label = bpy.data.objects.new("label", bpy.data.curves.new("label", "FONT"))
label.data.align_x = "CENTER"
label.data.size = 0.11
label.data.materials.append(txt_mat)
label.location = (0, -0.8, 2.25)
label.rotation_euler = (1.5708, 0, 0)
sc.collection.objects.link(label)

tiles = []
build = bake.BUILD_DIR / NAME / "tiles"
build.mkdir(parents=True, exist_ok=True)


def tile(suffix, text, frame=1):
    label.data.body = text
    tiles.append(render.render_front(NAME, meshes + [label], res_long=420, samples=12,
                                     bbox=TILE_BBOX, suffix=suffix, frame=frame, out_dir=build))


arm.data.pose_position = "REST"
ad.action = None
tile("00_tpose", "T-Pose (rest)")
arm.data.pose_position = "POSE"
for i, name in enumerate(clips, 1):
    action = bpy.data.actions[name]
    ad.action = action
    if hasattr(ad, "action_slot") and action.slots:
        ad.action_slot = action.slots[0]
    f0, f1 = map(int, action.frame_range)
    mid = (f0 + f1) // 2
    tile(f"{i:02d}_{name}", f"{name}  f{mid}", frame=mid)

# strip: all tiles side by side
imgs = [bpy.data.images.load(str(p)) for p in tiles]
w, h = imgs[0].size
import numpy as np  # noqa: E402
strip = np.zeros((h, w * len(imgs), 4), dtype=np.float32)
for i, im in enumerate(imgs):
    px = np.empty(w * h * 4, dtype=np.float32)
    im.pixels.foreach_get(px)
    strip[:, i * w:(i + 1) * w] = px.reshape(h, w, 4)
out = bpy.data.images.new("character_animations", w * len(imgs), h, alpha=True)
out.pixels.foreach_set(strip.ravel())
out_path = render.RENDER_DIR / "character_animations.png"
out.filepath_raw = str(out_path)
out.file_format = "PNG"
out.save()
print(f"[render] strip -> {out_path}")

# mandatory front + turntable (idle start pose, no label)
label.hide_render = True
ad.action = bpy.data.actions["idle"]
render.render_front(NAME, meshes, res_long=1600, samples=32)
render.render_turntable(NAME, meshes, frames=8, res=(480, 720), samples=12)

(bake.BUILD_DIR / NAME / "report.json").write_text(json.dumps(report, indent=2, default=str))
print("REPORT " + json.dumps(report, default=str))
