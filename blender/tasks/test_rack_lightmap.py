"""ISSUE-002 minimal test: lightmap bake of ONE populated rack, AO bake only.

Checks, in this order (printed as [chk1] / [chk2] / [chk3] / [px] / [obj]):
 (1) every rack mesh has the UV map 'Lightmap' (glTF TEXCOORD_1), it is the ACTIVE uv
     layer at bake time (Cycles writes into the active UV map) and covers 0..1 with area > 0
 (2) every material has the bake image node LM_TARGET with the bake image, it is the
     ACTIVE node; links on the node are reported (a bake target needs none)
 (3) every rack mesh is selected + visible + renderable when bpy.ops.object.bake runs
Then the baked image is read pixel by pixel (float buffer AND the saved PNG re-read):
alpha = written by the bake (0 = never written / missing), RGB = AO value (0 = black).
Per object: texel lookup at each face's UV1 centroid -> which objects got no texels.

blender -b -P blender/tasks/test_rack_lightmap.py
"""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

from lib import bake, devices, render, room  # noqa: E402

NAME = "test_rack_lightmap"
RES = 512
OUT = render.RENDER_DIR / NAME
OUT.mkdir(parents=True, exist_ok=True)

render.reset_scene()
rack = devices.build_rack_42he(name="rack_1")
rack.location = (room.RACK_FRONT_X, room.ROW_Y0 + 0.3, 0.0)
rack.rotation_euler = (0.0, 0.0, math.pi / 2)
devices.mount(rack, devices.build_pdu("r1_pdu_1u", style="1u", amps="2.4"), 1)
room._populate(rack, 1)
bpy.context.view_layer.update()
objs = room._descendants(rack)
non_mesh = [o.name for o in objs if o.type != "MESH"]
print(f"[info] {len(objs)} objects in group, non-mesh: {non_mesh}")
meshes = [o for o in objs if o.type == "MESH"]
shared = {}
for o in meshes:
    shared.setdefault(o.data.name, []).append(o.name)
print(f"[info] mesh datablocks shared by >1 object: {[v for v in shared.values() if len(v) > 1]}")

bake.apply_modifiers(objs)
bake.unwrap_lightmap(objs, res=RES)
report = {"chk1": {}, "chk2": {}, "chk3": {}, "px": {}, "obj": {}}

# ---- (1) UV map ---------------------------------------------------------------
bad1 = 0
for o in meshes:
    me = o.data
    lm = me.uv_layers.get(bake.LM_UV)
    if lm is None:
        report["chk1"][o.name] = "NO Lightmap UV"
        bad1 += 1
        continue
    uv = np.empty(len(me.loops) * 2, dtype=np.float32)
    lm.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    area = 0.0
    for p in me.polygons:
        pts = uv[p.loop_start:p.loop_start + p.loop_total]
        x, y = pts[:, 0], pts[:, 1]
        area += 0.5 * abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))
    r = {"active": me.uv_layers.active.name, "active_render": next(u.name for u in me.uv_layers if u.active_render),
         "layers": [u.name for u in me.uv_layers], "min": uv.min(0).round(3).tolist(),
         "max": uv.max(0).round(3).tolist(), "area": round(area, 6), "faces": len(me.polygons)}
    ok = r["active"] == bake.LM_UV and area > 0 and uv.min() >= -1e-4 and uv.max() <= 1 + 1e-4
    bad1 += not ok
    report["chk1"][o.name] = r
    if not ok:
        print(f"[chk1] FAIL {o.name}: {r}")
print(f"[chk1] UV 'Lightmap' active + in 0..1 + area>0: {len(meshes) - bad1}/{len(meshes)} OK")

# ---- AO bake setup exactly like bake.bake_lightmap (target node per material) ----
bake._cycles(16)
raw = bpy.data.images.new(f"LM_{NAME}_raw", RES, RES, alpha=True, float_buffer=True)
mats = {s.material for o in meshes for s in o.material_slots if s.material is not None}
no_slot = [o.name for o in meshes if not any(s.material for s in o.material_slots)]
for m in mats:
    nt = m.node_tree
    node = nt.nodes.get("LM_TARGET") or nt.nodes.new("ShaderNodeTexImage")
    node.name = "LM_TARGET"
    node.image = raw
    nt.nodes.active = node
for o in meshes:
    o.data.uv_layers.active = o.data.uv_layers[bake.LM_UV]

# ---- (2) bake image node -----------------------------------------------------------
bad2 = 0
for m in sorted(mats, key=lambda m: m.name):
    nt = m.node_tree
    node = nt.nodes.get("LM_TARGET")
    r = {"use_nodes": m.use_nodes, "node": node is not None,
         "image": node.image.name if node and node.image else None,
         "active": nt.nodes.active == node if node else False,
         "links_in": [l.from_node.name for l in nt.links if node and l.to_node == node],
         "links_out": [l.to_node.name for l in nt.links if node and l.from_node == node],
         "output_linked": any(n.type == "OUTPUT_MATERIAL" and n.inputs["Surface"].is_linked for n in nt.nodes)}
    ok = r["use_nodes"] and r["node"] and r["image"] == raw.name and r["active"] and r["output_linked"]
    bad2 += not ok
    report["chk2"][m.name] = r
    if not ok:
        print(f"[chk2] FAIL {m.name}: {r}")
print(f"[chk2] LM_TARGET present + bake image + active node: {len(mats) - bad2}/{len(mats)} OK; "
      f"objects without any material: {no_slot}")

# ---- (3) selection right before the bake ------------------------------------------
bake._select(objs)
vl = bpy.context.view_layer
bad3 = 0
for o in meshes:
    r = {"selected": o.select_get(), "visible": o.visible_get(), "hide_render": o.hide_render,
         "in_view_layer": o.name in vl.objects}
    ok = r["selected"] and r["visible"] and not r["hide_render"] and r["in_view_layer"]
    bad3 += not ok
    report["chk3"][o.name] = r
    if not ok:
        print(f"[chk3] FAIL {o.name}: {r}")
act = vl.objects.active
print(f"[chk3] selected + visible + renderable: {len(meshes) - bad3}/{len(meshes)} OK; "
      f"active = {act.name if act else None} (type {act.type if act else '-'})")

# ---- bake ---------------------------------------------------------------------------
err = None
try:
    bpy.ops.object.bake(type="AO", margin=bake.BAKE_MARGIN_PX, margin_type="EXTEND", use_clear=True)
except Exception as e:  # noqa: BLE001 - report, do not hide
    err = repr(e)
print(f"[bake] AO bake error: {err}")


def stats(px, label):
    a, rgb = px[:, 3], px[:, :3]
    written = a > 0.5
    s = {"pixels": int(len(px)), "alpha>0.5": int(written.sum()), "alpha==0": int((a == 0).sum()),
         "rgb>0 (any channel)": int((rgb.max(1) > 0).sum()),
         "written_and_black": int((written & (rgb.max(1) == 0)).sum()),
         "rgb_min": float(rgb.min()), "rgb_max": float(rgb.max()),
         "rgb_mean_written": float(rgb[written].mean()) if written.any() else None,
         "nan": int(np.isnan(px).sum())}
    print(f"[px] {label}: {s}")
    return s


px = bake._pixels(raw)
report["px"]["float_buffer"] = stats(px, "float buffer (raw)")
png = OUT / f"{NAME}_ao.png"
raw.filepath_raw = str(png)
raw.file_format = "PNG"
raw.save()
re = bpy.data.images.load(str(png), check_existing=False)
report["px"]["png_reread"] = stats(bake._pixels(re), f"PNG re-read {png.name} {tuple(re.size)}")

# ---- per object: texel at each face's UV1 centroid ----------------------------------
img = px.reshape(RES, RES, 4)
empty_objs = []
for o in meshes:
    me = o.data
    uv = np.empty(len(me.loops) * 2, dtype=np.float32)
    me.uv_layers[bake.LM_UV].data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    hit = 0
    for p in me.polygons:
        c = uv[p.loop_start:p.loop_start + p.loop_total].mean(0)
        x = min(RES - 1, max(0, int(c[0] * RES)))
        y = min(RES - 1, max(0, int(c[1] * RES)))
        hit += img[y, x, 3] > 0.5
    report["obj"][o.name] = {"faces": len(me.polygons), "faces_with_texel": int(hit)}
    if hit == 0:
        empty_objs.append(o.name)
print(f"[obj] objects with NO written texel at any face centroid: {len(empty_objs)}/{len(meshes)} {empty_objs[:12]}")

(OUT / f"{NAME}_report.json").write_text(json.dumps(report, indent=1, default=str))
print(f"[done] report {OUT / (NAME + '_report.json')}")

render.setup_lights(meshes)
render.render_front(NAME, meshes, res_long=1200, samples=16)
render.render_turntable(NAME, meshes, frames=8, res=(480, 640), samples=8)
