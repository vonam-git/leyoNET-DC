"""UV helpers."""


def box_project(obj, tile=1.0, name="UVMap", world=True):
    """Axis-aligned box projection: 1 UV unit = `tile` metres. Creates/overwrites
    the UV layer `name` (kept as the first layer if newly created)."""
    me = obj.data
    uv = me.uv_layers.get(name) or me.uv_layers.new(name=name)
    mw = obj.matrix_world if world else None
    rot = mw.to_3x3() if world else None
    verts = me.vertices
    for p in me.polygons:
        n = rot @ p.normal if world else p.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in p.loop_indices:
            co = verts[me.loops[li].vertex_index].co
            if world:
                co = mw @ co
            if ax == 0:
                u, v = co.y * (1 if n.x > 0 else -1), co.z
            elif ax == 1:
                u, v = co.x * (-1 if n.y > 0 else 1), co.z
            else:
                u, v = co.x, co.y * (1 if n.z > 0 else -1)
            uv.data[li].uv = (u / tile, v / tile)
    return uv


def box_project_aligned(obj, tile=1.0, name="UVMap"):
    """Like box_project (world space), but per face the U axis follows the face's
    longer in-plane extent - brushed-metal grain runs along each part's length."""
    me = obj.data
    uv = me.uv_layers.get(name) or me.uv_layers.new(name=name)
    mw = obj.matrix_world
    rot = mw.to_3x3()
    verts = me.vertices
    for p in me.polygons:
        n = rot @ p.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        a, b = [i for i in range(3) if i != ax]
        cos = [mw @ verts[me.loops[li].vertex_index].co for li in p.loop_indices]
        ea = max(c[a] for c in cos) - min(c[a] for c in cos)
        eb = max(c[b] for c in cos) - min(c[b] for c in cos)
        if eb > ea:
            a, b = b, a
        for li, co in zip(p.loop_indices, cos):
            uv.data[li].uv = (co[a] / tile, co[b] / tile)
    return uv


def grid_project(obj, origin, cell, name="UVMap"):
    """Raised-floor tiles: every face gets UVs in metres local to its grid cell
    (one cell = one manufactured tile), rotated by a per-cell 0/90/180/270 deg
    so neighbouring tiles do not repeat visibly. Side faces use box mapping."""
    me = obj.data
    uv = me.uv_layers.get(name) or me.uv_layers.new(name=name)
    mw = obj.matrix_world
    verts = me.vertices
    ox, oy = origin
    for p in me.polygons:
        c = mw @ p.center
        i, j = int((c.x - ox) // cell), int((c.y - oy) // cell)
        x0, y0 = ox + i * cell, oy + j * cell
        rot = (i * 7 + j * 13) % 4
        n = (mw.to_3x3() @ p.normal)
        for li in p.loop_indices:
            co = mw @ verts[me.loops[li].vertex_index].co
            if abs(n.z) > 0.5:
                u, v = co.x - x0, co.y - y0
                for _ in range(rot):
                    u, v = cell - v, u
            elif abs(n.x) > abs(n.y):
                u, v = co.y, co.z
            else:
                u, v = co.x, co.z
            uv.data[li].uv = (u, v)
    return uv


# --- lightmap UV for detailed objects (devices, rack housing) ------------------------------
PLANE_GAP = 0.005   # m: faces of one side closer than this along the axis form one plane


def _plane_clusters(objs):
    """Group faces of `objs` into (object, axis, sign, depth-plane) clusters.
    Returns list of dict(obj, ax, faces=[poly index], rect=(u0, v0, u1, v1) in metres)."""
    out = []
    for o in objs:
        me, mw = o.data, o.matrix_world
        rot = mw.to_3x3()
        sides = {}
        for p in me.polygons:
            n = rot @ p.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            c = mw @ p.center
            sides.setdefault((ax, n[ax] > 0), []).append((c[ax], p.index))
        for (ax, _pos), items in sides.items():
            items.sort()
            groups, cur, last = [], [], None
            for d, pi in items:
                if last is not None and d - last > PLANE_GAP:
                    groups.append(cur)
                    cur = []
                cur.append(pi)
                last = d
            groups.append(cur)
            a, b = [i for i in range(3) if i != ax]
            for g in groups:
                us, vs = [], []
                for pi in g:
                    for vi in me.polygons[pi].vertices:
                        co = mw @ me.vertices[vi].co
                        us.append(co[a])
                        vs.append(co[b])
                out.append(dict(obj=o, ax=ax, a=a, b=b, faces=g,
                                rect=(min(us), min(vs), max(us), max(vs))))
    return out


def _shelf_layout(sizes, scale, pad):
    """Shelf-pack rectangles (w, h in metres, already rotated so h <= w) at `scale`
    with `pad` UV units around each. Returns (positions, used height) or None if a
    rectangle is wider than the atlas."""
    order = sorted(range(len(sizes)), key=lambda i: -sizes[i][1])
    pos = [None] * len(sizes)
    x = y = shelf_h = 0.0
    for i in order:
        w, h = sizes[i][0] * scale + 2 * pad, sizes[i][1] * scale + 2 * pad
        if w > 1.0:
            return None
        if x + w > 1.0:
            x, y, shelf_h = 0.0, y + shelf_h, 0.0
        pos[i] = (x + pad, y + pad)
        x += w
        shelf_h = max(shelf_h, h)
    return pos, y + shelf_h


def plane_lightmap(objs, name, res, margin_px):
    # margin_px = padding on EACH side of a rectangle (2x between neighbours)
    """Lightmap UV `name` for many-island meshes: one rectangle per (object, side,
    depth plane) - faces of one plane never overlap - packed into 0..1 with a fixed
    pixel margin. Blender's pack_islands collapses ~10k per-face islands to zero area
    (ISSUE-002). Returns (n_rects, uv_fill)."""
    cl = _plane_clusters(objs)
    sizes, rotated = [], []
    for c in cl:
        u0, v0, u1, v1 = c["rect"]
        w, h = max(u1 - u0, 1e-4), max(v1 - v0, 1e-4)
        rotated.append(h > w)
        sizes.append((h, w) if h > w else (w, h))
    pad = margin_px / res
    lo, hi = 0.0, 64.0
    for _ in range(40):                     # largest scale whose layout still fits
        mid = (lo + hi) / 2
        r = _shelf_layout(sizes, mid, pad)
        if r is not None and r[1] <= 1.0:
            lo = mid
        else:
            hi = mid
    if lo <= 0.0:
        raise RuntimeError(f"plane_lightmap: {len(cl)} rects with {margin_px}px margin do not fit "
                           f"into {res}px - raise the lightmap resolution")
    pos, _ = _shelf_layout(sizes, lo, pad)
    for o in objs:
        if name not in o.data.uv_layers:
            o.data.uv_layers.new(name=name)
    for c, (px, py), rot in zip(cl, pos, rotated):
        o, me, mw = c["obj"], c["obj"].data, c["obj"].matrix_world
        uvl = me.uv_layers[name].data
        u0, v0 = c["rect"][0], c["rect"][1]
        for pi in c["faces"]:
            for li in me.polygons[pi].loop_indices:
                co = mw @ me.vertices[me.loops[li].vertex_index].co
                du, dv = (co[c["a"]] - u0) * lo, (co[c["b"]] - v0) * lo
                uvl[li].uv = (px + dv, py + du) if rot else (px + du, py + dv)
    fill = sum(w * h for w, h in sizes) * lo * lo
    return len(cl), fill
