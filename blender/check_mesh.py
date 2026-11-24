"""Polycount report (triangles) per device and per room/scene.

Standalone:  blender -b <file.blend> -P blender/check_mesh.py [-- --out report.json]
In a task:   import check_mesh; ok, data = check_mesh.report(out_path)

Limits (CLAUDE.md): max 50k tris per device, max 300k per room (scene).
Every object tagged with a custom prop 'leyonet_kind' counts as one asset
(itself + descendants that are not assets of their own). Untagged top-level
meshes are listed separately and count towards the room total.
Exit code 1 when a limit is exceeded (standalone mode).
"""
import json
import sys

import bpy

LIMIT_DEVICE = 50_000
LIMIT_ROOM = 300_000


def _tris(obj, depsgraph):
    ev = obj.evaluated_get(depsgraph)
    me = ev.to_mesh()
    try:
        return sum(len(p.vertices) - 2 for p in me.polygons)
    finally:
        ev.to_mesh_clear()


def _asset_tris(root, depsgraph):
    total = _tris(root, depsgraph) if root.type == "MESH" else 0
    stack = list(root.children)
    while stack:
        o = stack.pop()
        if "leyonet_kind" in o:
            continue
        if o.type == "MESH":
            total += _tris(o, depsgraph)
        stack.extend(o.children)
    return total


def report(out_path=None, ignore=("floor",)):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    scene = bpy.context.scene
    assets = [o for o in scene.objects if "leyonet_kind" in o]
    rows = []
    for o in sorted(assets, key=lambda o: o.name):
        t = _asset_tris(o, depsgraph)
        rows.append({"name": o.name, "kind": o["leyonet_kind"], "tris": t,
                     "ok": t <= LIMIT_DEVICE})

    def owned(o):
        p = o
        while p is not None:
            if "leyonet_kind" in p:
                return True
            p = p.parent
        return False

    other = [o for o in scene.objects
             if o.type == "MESH" and not owned(o) and o.name not in ignore]
    other_tris = sum(_tris(o, depsgraph) for o in other)
    room = sum(r["tris"] for r in rows) + other_tris
    ok = all(r["ok"] for r in rows) and room <= LIMIT_ROOM

    print("\n=== Polycount report " + "=" * 40)
    print(f"{'asset':<28}{'kind':<12}{'tris':>10}  limit")
    for r in rows:
        print(f"{r['name']:<28}{r['kind']:<12}{r['tris']:>10,}  {'OK' if r['ok'] else 'OVER 50k'}")
    if other:
        print(f"{'(untagged meshes)':<40}{other_tris:>10,}")
    print(f"{'ROOM TOTAL':<40}{room:>10,}  {'OK' if room <= LIMIT_ROOM else 'OVER 300k'}")
    print(f"RESULT: {'PASS' if ok else 'FAIL'}")
    print("=" * 61 + "\n")

    data = {"assets": rows, "untagged_tris": other_tris, "room_tris": room,
            "limit_device": LIMIT_DEVICE, "limit_room": LIMIT_ROOM, "ok": ok}
    if out_path:
        with open(out_path, "w") as f:
            json.dump(data, f, indent=2)
    return ok, data


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = argv[argv.index("--out") + 1] if "--out" in argv else None
    ok, _ = report(out)
    sys.exit(0 if ok else 1)
