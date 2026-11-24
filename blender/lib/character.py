"""Mixamo character helpers: FBX import, clip merging onto one armature,
in-place fix for root motion, texture slimming. Never rigs anything itself.

Export goes through bake.export_character_glb (the only export path).
"""
import re
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

ARMATURE_NAME = "Armature"


def clip_name(path):
    """'Crouched Walking.fbx' -> 'crouched_walking' (file stem, snake_case)."""
    return re.sub(r"[^a-z0-9]+", "_", Path(path).stem.lower()).strip("_")


def import_fbx(path):
    """Import one Mixamo FBX (scale 1.0, no automatic bone orientation).
    Returns (armature, meshes, action, new_ids)."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=str(path), global_scale=1.0,
                             automatic_bone_orientation=False, use_anim=True)
    new = [o for o in bpy.data.objects if o not in before]
    arms = [o for o in new if o.type == "ARMATURE"]
    if len(arms) != 1:
        raise RuntimeError(f"{path}: expected 1 armature, got {len(arms)}")
    arm = arms[0]
    meshes = [o for o in new if o.type == "MESH"]
    ad = arm.animation_data
    action = ad.action if ad else None
    return arm, meshes, action, new


def bone_prefix(arm):
    return arm.data.bones[0].name.split(":")[0] if ":" in arm.data.bones[0].name else ""


def unify_bone_names(arm, action, prefix="mixamorig"):
    """Rename bones '<anyprefix>:X' -> '<prefix>:X' on arm and in action paths.
    No-op if the prefix already matches."""
    old = bone_prefix(arm)
    if old == prefix or not old:
        return 0
    for b in arm.data.bones:
        b.name = prefix + b.name[len(old):]
    if action:
        for fc in action.fcurves:
            fc.data_path = fc.data_path.replace(f'"{old}:', f'"{prefix}:')
    return len(arm.data.bones)


def remove_objects(objs):
    """Delete objects + their data, then purge orphans (big packed images)."""
    datas = [o.data for o in objs if o.data is not None]
    bpy.data.batch_remove(objs)
    bpy.data.batch_remove([d for d in datas if d.users == 0])
    bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)


# --- clips ---------------------------------------------------------------------
def add_clip(arm, action, name):
    """Rename action to `name` and put it on its own NLA track of `arm`."""
    action.name = name
    action.use_fake_user = True
    ad = arm.animation_data or arm.animation_data_create()
    track = ad.nla_tracks.new()
    track.name = name
    start = int(action.frame_range[0])
    strip = track.strips.new(name, start, action)
    if hasattr(strip, "action_slot") and getattr(action, "slots", None):
        strip.action_slot = action.slots[0]
    track.mute = False
    return track


def hips_world_track(arm, action, bone, step=1):
    """World positions of `bone`'s head over the action's frame range."""
    sc = bpy.context.scene
    ad = arm.animation_data or arm.animation_data_create()
    prev = ad.action
    solo = [(t, t.mute) for t in ad.nla_tracks]
    for t, _m in solo:
        t.mute = True
    ad.action = action
    if hasattr(ad, "action_slot") and getattr(action, "slots", None):
        ad.action_slot = action.slots[0]
    f0, f1 = map(int, action.frame_range)
    pts = []
    pb = arm.pose.bones[bone]
    for fr in range(f0, f1 + 1, step):
        sc.frame_set(fr)
        pts.append((fr, (arm.matrix_world @ pb.head).copy()))
    ad.action = prev
    for t, m in solo:
        t.mute = m
    return pts


def horizontal_drift(pts):
    a, b = pts[0][1], pts[-1][1]
    return Vector((b.x - a.x, b.y - a.y, 0.0))


def make_in_place(arm, action, bone):
    """Remove the linear horizontal (world XY) drift of the root bone from the
    clip's location keys; keeps the per-step oscillation. Returns
    (drift_before_m, residual_range_after_m)."""
    pts = hips_world_track(arm, action, bone)
    f0, f1 = pts[0][0], pts[-1][0]
    drift = horizontal_drift(pts)
    rest = arm.data.bones[bone].matrix_local.to_3x3()
    to_local = rest.inverted() @ arm.matrix_world.to_3x3().inverted()
    path = f'pose.bones["{bone}"].location'
    fcs = {fc.array_index: fc for fc in action.fcurves if fc.data_path == path}
    if len(fcs) != 3:
        raise RuntimeError(f"{action.name}: root location curves missing ({sorted(fcs)})")
    frames = sorted({round(k.co[0]) for fc in fcs.values() for k in fc.keyframe_points})
    # evaluate all three channels before editing (shared frames)
    vals = {fr: Vector([fcs[i].evaluate(fr) for i in range(3)]) for fr in frames}
    for fc in fcs.values():
        fc.keyframe_points.clear()
    for fr in frames:
        t = (fr - f0) / max(1, f1 - f0)
        loc = vals[fr] - to_local @ (drift * t)
        for i in range(3):
            fcs[i].keyframe_points.insert(fr, loc[i], options={"FAST"}).interpolation = "LINEAR"
    for fc in fcs.values():
        fc.update()
    after = hips_world_track(arm, action, bone)
    xs = [p.x for _f, p in after]
    ys = [p.y for _f, p in after]
    residual = max(max(xs) - min(xs), max(ys) - min(ys))
    return drift.length, residual, horizontal_drift(after).length


# --- textures --------------------------------------------------------------------
def _resize(img, size):
    if img.size[0] > size:
        img.scale(size, size)
    return img


def _to_file(img, out_dir, fmt, colorspace, quality=88):
    """Write img's pixels to <out_dir>/<name>.<ext> (JPEG/PNG) and return the
    re-loaded, unpacked file image, so the glTF exporter (AUTO) keeps the format."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    ext = "jpg" if fmt == "JPEG" else "png"
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    tmp = bpy.data.images.new(f"_tmp_{img.name}", w, h, alpha=(fmt == "PNG"))
    tmp.colorspace_settings.name = colorspace
    tmp.pixels.foreach_set(px)
    path = out_dir / f"{img.name}.{ext}"
    tmp.filepath_raw = str(path)
    tmp.file_format = fmt
    tmp.save(filepath=str(path), quality=quality)
    bpy.data.images.remove(tmp)
    new = bpy.data.images.load(str(path), check_existing=False)
    new.name = img.name + "_out"
    new.colorspace_settings.name = colorspace
    return new


def slim_materials(meshes, out_dir, base=2048, normal=2048, rough=1024, hair=1024, quality=88):
    """Mixamo materials -> lean glTF-ready PBR:
    * Glossiness map (FBX importer wires it straight into Roughness) is
      inverted into a real roughness image.
    * Specular map dropped (Specular IOR Level back to 0.5, metallic 0).
    * Images downscaled; opaque ones flagged JPEG, alpha ones stay PNG.
    * Alpha (hair cards) -> Math Round so glTF exports alphaMode MASK."""
    mats = sorted({m for o in meshes for m in o.data.materials if m}, key=lambda m: m.name)
    report = {}
    cache = {}

    def to_file(img, fmt, cs):
        if img.name not in cache:
            cache[img.name] = _to_file(img, out_dir, fmt, cs, quality)
        return cache[img.name]
    for m in mats:
        nt = m.node_tree
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        has_alpha = bsdf.inputs["Alpha"].is_linked
        # base colour
        bc = bsdf.inputs["Base Color"].links[0].from_node
        if not bc.image.name.endswith("_out"):
            _resize(bc.image, hair if has_alpha else base)
            bc.image = to_file(bc.image, "PNG" if has_alpha else "JPEG", "sRGB")
        if has_alpha:   # alpha comes from the same diffuse file -> one image only
            an = bsdf.inputs["Alpha"].links[0].from_node
            if an.type == "TEX_IMAGE":
                an.image = bc.image
        # normal
        nm = bsdf.inputs["Normal"].links[0].from_node
        ntex = nm.inputs["Color"].links[0].from_node
        if not ntex.image.name.endswith("_out"):
            _resize(ntex.image, normal)
            ntex.image = to_file(ntex.image, "JPEG", "Non-Color")
        # specular off
        sp = bsdf.inputs["Specular IOR Level"]
        for lk in list(sp.links):
            nt.nodes.remove(lk.from_node)
        sp.default_value = 0.5
        bsdf.inputs["Metallic"].default_value = 0.0
        # roughness
        rin = bsdf.inputs["Roughness"]
        if rin.is_linked:
            gnode = rin.links[0].from_node
            g = gnode.image
            if g.get("leyonet_roughness"):
                pass
            else:
                _resize(g, rough)
                px = np.empty(g.size[0] * g.size[1] * 4, dtype=np.float32)
                g.pixels.foreach_get(px)
                px = px.reshape(-1, 4)
                r = 1.0 - px[:, 0]
                out = np.stack([r, r, r, np.ones_like(r)], 1).ravel()
                ri = bpy.data.images.new(f"{m.name}_roughness", g.size[0], g.size[1], alpha=False)
                ri.colorspace_settings.name = "Non-Color"
                ri.pixels.foreach_set(out)
                ri = to_file(ri, "JPEG", "Non-Color")
                ri["leyonet_roughness"] = 1
                gnode.image = ri
                report[m.name + ".roughness_mean"] = round(float(r.mean()), 3)
        else:
            # hair has no gloss map: keep a constant but not perfectly flat value
            rin.default_value = 0.55
        if has_alpha:
            al = bsdf.inputs["Alpha"].links[0]
            rnd = nt.nodes.new("ShaderNodeMath")
            rnd.operation = "ROUND"
            nt.links.new(al.from_socket, rnd.inputs[0])
            nt.links.new(rnd.outputs[0], bsdf.inputs["Alpha"])
        report[m.name] = {"alpha": has_alpha}
    # drop images that are no longer used (gloss/specular originals)
    bpy.data.orphans_purge(do_local_ids=True, do_recursive=True)
    for img in bpy.data.images:
        report.setdefault("images", []).append(f"{img.name} {img.size[0]}px {img.file_format}")
    return report


def decimate_to(meshes, limit, prefer="Ch31_Body"):
    """Collapse-decimate the largest (or `prefer`) mesh just enough to get the
    character total under `limit` tris. Returns (before, after)."""
    def tris(o):
        return sum(len(p.vertices) - 2 for p in o.data.polygons)
    before = sum(tris(o) for o in meshes)
    if before <= limit:
        return before, before
    target = next((o for o in meshes if o.name.startswith(prefer)), max(meshes, key=tris))
    over = before - limit
    ratio = max(0.5, 1.0 - (over * 1.15) / tris(target))
    mod = target.modifiers.new("decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    vl = bpy.context.view_layer
    vl.objects.active = target
    # the decimate must sit before the armature modifier
    while target.modifiers[0] != mod:
        bpy.ops.object.modifier_move_up(modifier=mod.name)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return before, sum(tris(o) for o in meshes)
