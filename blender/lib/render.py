"""Headless render helpers: orthographic front view + turntable (Cycles CPU)."""
import math
from pathlib import Path

import bpy
from mathutils import Vector

from . import materials

ROOT = Path(__file__).resolve().parents[2]
RENDER_DIR = ROOT / "blender" / "render"


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 6
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    world = bpy.data.worlds.new("world")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.55, 0.57, 0.60, 1.0)
    bg.inputs["Strength"].default_value = 0.35
    scene.world = world
    return scene


def world_bbox(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs if o.type == "MESH" for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def _area(name, loc, target, size, power):
    data = bpy.data.lights.new(name, "AREA")
    data.size = size
    data.energy = power
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = loc
    obj.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    return obj


def setup_lights(objs, floor=True):
    """Studio lighting scaled to the subject bbox; optional floor plane."""
    lo, hi = world_bbox(objs)
    c = (lo + hi) / 2
    s = max((hi - lo).length, 0.3)
    _area("key", c + Vector((-0.8, -1.6, 0.9)) * s, c, s * 0.9, 50 * s * s)
    _area("fill", c + Vector((1.0, -1.4, 0.2)) * s, c, s * 0.9, 20 * s * s)
    _area("front", c + Vector((0.0, -1.8, 0.0)) * s, c, s * 0.6, 12 * s * s)
    _area("rim", c + Vector((0.3, 1.6, 1.0)) * s, c, s * 0.7, 30 * s * s)
    if floor:
        me = bpy.data.meshes.new("floor")
        r = s * 4
        me.from_pydata([(-r, -r, 0), (r, -r, 0), (r, r, 0), (-r, r, 0)], [], [(0, 1, 2, 3)])
        me.materials.append(materials.get("floor"))
        fl = bpy.data.objects.new("floor", me)
        fl.location.z = lo.z - 0.0005
        bpy.context.scene.collection.objects.link(fl)


def _camera(name):
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    return cam


def front_axis(obj):
    """World direction the front of `obj` faces (devices/racks: local -Y)."""
    return (obj.matrix_world.to_3x3() @ Vector((0.0, -1.0, 0.0))).normalized()


def render_front(name, objs, res_long=2400, samples=64, pad=1.04, bbox=None, suffix="front",
                 clip_start=None, frame=1, out_dir=None, front=(0.0, -1.0, 0.0), isolate=False,
                 studio=False):
    """Orthographic elevation of the side of `objs` that faces `front` (world vector,
    default -Y; use front_axis(rack) for rotated racks). Camera, framing and the
    optional studio lights are placed RELATIVE to the objects' bounding box along
    that axis, never at absolute room positions (ISSUE-004).
    isolate=True hides every other object for this render (walls, glazing in front);
    studio=True adds temporary key/fill/front lights. bbox=(lo, hi) overrides the
    framed region (detail crops); clip_start cuts away everything closer than that."""
    scene = bpy.context.scene
    f = Vector(front).normalized()
    up = Vector((0.0, 0.0, 1.0)) if abs(f.z) < 0.9 else Vector((0.0, 1.0, 0.0))
    right = (-f).cross(up).normalized()
    up = right.cross(-f).normalized()
    if bbox:
        lo, hi = Vector(bbox[0]), Vector(bbox[1])
        pts = [Vector((x, y, z)) for x in (lo.x, hi.x) for y in (lo.y, hi.y) for z in (lo.z, hi.z)]
    else:
        pts = [o.matrix_world @ Vector(c) for o in objs if o.type == "MESH" for c in o.bound_box]
    pr = [p.dot(right) for p in pts]
    pu = [p.dot(up) for p in pts]
    pf = [p.dot(f) for p in pts]
    w, h = (max(pr) - min(pr)) * pad, (max(pu) - min(pu)) * pad
    centre = right * (max(pr) + min(pr)) / 2 + up * (max(pu) + min(pu)) / 2 + f * (max(pf) + min(pf)) / 2
    depth = max(pf) - min(pf)
    cam = _camera(f"{name}_front_cam")
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = max(w, h)
    cam.data.clip_end = 100
    if clip_start is not None:
        cam.data.clip_start = clip_start
    cam.location = centre + f * (depth / 2 + 3.0)
    cam.rotation_euler = (-f).to_track_quat("-Z", "Y").to_euler()
    if w >= h:
        scene.render.resolution_x, scene.render.resolution_y = res_long, max(64, round(res_long * h / w))
    else:
        scene.render.resolution_x, scene.render.resolution_y = max(64, round(res_long * w / h)), res_long
    scene.render.resolution_percentage = 100
    scene.cycles.samples = samples
    scene.frame_set(frame)

    hidden, temp = [], []
    if isolate:
        keep = set(objs)
        for o in scene.objects:
            if o not in keep and o.type not in ("CAMERA", "LIGHT") and not o.hide_render:
                o.hide_render = True
                hidden.append(o)
    if studio:
        s = max(w, h, 0.3)
        for nm, (a, b, c), size, pw in (("key", (-0.8, 1.6, 0.9), 0.9, 50), ("fill", (1.0, 1.4, 0.2), 0.9, 20),
                                        ("front", (0.0, 1.8, 0.0), 0.6, 12)):
            temp.append(_area(f"{name}_{nm}", centre + (right * a + f * b + up * c) * s, centre,
                              s * size, pw * s * s))
    out = Path(out_dir or RENDER_DIR) / f"{name}_{suffix}.png"
    scene.render.filepath = str(out)
    scene.render.image_settings.file_format = "PNG"
    try:
        bpy.ops.render.render(write_still=True)
    finally:
        for o in hidden:
            o.hide_render = False
        for o in temp:
            data = o.data
            bpy.data.objects.remove(o)
            bpy.data.lights.remove(data)
    print(f"[render] {suffix} -> {out} (front {tuple(round(v, 3) for v in f)})")
    return out


def render_turntable(name, objs, frames=24, res=(720, 960), samples=24, lens=50, cutaway=(),
                     hide=(), elevation=0.45):
    """Perspective 360 deg turntable around the subject, PNG frames.
    cutaway: [(obj, outward_normal)] hidden in frames where they face the camera
    (room walls); hide: objects never visible to the camera (e.g. ceiling)."""
    scene = bpy.context.scene
    lo, hi = world_bbox(objs)
    c = (lo + hi) / 2
    size = (hi - lo).length
    pivot = bpy.data.objects.new(f"{name}_pivot", None)
    scene.collection.objects.link(pivot)
    pivot.location = (c.x, c.y, 0.0)
    target = bpy.data.objects.new(f"{name}_target", None)
    scene.collection.objects.link(target)
    target.location = c
    cam = _camera(f"{name}_turn_cam")
    cam.data.lens = lens
    cam.data.clip_end = 100
    cam.parent = pivot
    dist = size * 1.6 * (50 / lens)
    cam.location = (0.0, -dist, c.z + size * elevation)
    tr = cam.constraints.new("TRACK_TO")
    tr.target = target
    tr.track_axis = "TRACK_NEGATIVE_Z"
    tr.up_axis = "UP_Y"
    scene.frame_start, scene.frame_end = 1, frames
    pivot.rotation_euler = (0, 0, 0)
    pivot.keyframe_insert("rotation_euler", index=2, frame=1)
    pivot.rotation_euler = (0, 0, 2 * math.pi)
    pivot.keyframe_insert("rotation_euler", index=2, frame=frames + 1)
    for fc in pivot.animation_data.action.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
    for o in hide:
        o.visible_camera = False
    for f in range(1, frames + 1):
        th = 2 * math.pi * (f - 1) / frames
        cdir = Vector((math.sin(th), -math.cos(th), 0.0))
        for o, n in cutaway:
            o.hide_render = Vector(n).dot(cdir) > 0.25
            o.keyframe_insert("hide_render", frame=f)
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.cycles.samples = samples
    out_dir = RENDER_DIR / f"{name}_turntable"
    out_dir.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(out_dir / "frame_")
    scene.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(animation=True)
    print(f"[render] turntable ({frames} frames) -> {out_dir}")
    return out_dir


def render_view(name, suffix, loc, target, lens=16, res=(1280, 720), samples=64, frame=1, out_dir=None):
    """Perspective still from `loc` looking at `target`."""
    scene = bpy.context.scene
    cam = _camera(f"{name}_{suffix}_cam")
    cam.data.lens = lens
    cam.data.clip_start = 0.02
    cam.data.clip_end = 100
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    scene.cycles.samples = samples
    scene.frame_set(frame)
    out = Path(out_dir or RENDER_DIR) / f"{name}_{suffix}.png"
    scene.render.filepath = str(out)
    scene.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)
    print(f"[render] {suffix} -> {out}")
    return out
