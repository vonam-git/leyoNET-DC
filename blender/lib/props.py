"""Room props + cabling (Realismus-Regel 5 and room dressing).

* cable bundles: centripetal Catmull-Rom centre line through hand-placed control
  points with real sag (never taut), N cables hex-packed around it with a slight
  twist, fanned out into their own ports at both ends, RJ45 boots, cable ties
  every ~30 cm along the bundled section
* exit sign (ISO 7010 E001 style, backlit -> emissive face), fire extinguisher
  (6 kg, wall bracket, hose), cardboard box
Materials: ambientCG texture sets (lib.textures) except emissive sign faces.
UV0 in metres (tubes: u along the cable, v around it).
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

from . import materials, uvtools
from .devices import MeshBuilder, U, u_bottom

TIE_SPACING = 0.30


# --- Catmull-Rom -------------------------------------------------------------------
def catmull_rom(points, samples_per_m=80, alpha=0.5):
    """Centripetal Catmull-Rom spline through `points` (end points duplicated).
    Returns a dense list of Vectors."""
    pts = [Vector(p) for p in points]
    pts = [pts[0] + (pts[0] - pts[1]) * 0.01, *pts, pts[-1] + (pts[-1] - pts[-2]) * 0.01]
    out = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1:i + 3]

        def tj(ti, a, b):
            return ti + max((b - a).length, 1e-6) ** alpha

        t0 = 0.0
        t1 = tj(t0, p0, p1)
        t2 = tj(t1, p1, p2)
        t3 = tj(t2, p2, p3)
        n = max(2, int((p2 - p1).length * samples_per_m))
        for k in range(n):
            t = t1 + (t2 - t1) * k / n
            a1 = p0 * ((t1 - t) / (t1 - t0)) + p1 * ((t - t0) / (t1 - t0))
            a2 = p1 * ((t2 - t) / (t2 - t1)) + p2 * ((t - t1) / (t2 - t1))
            a3 = p2 * ((t3 - t) / (t3 - t2)) + p3 * ((t - t2) / (t3 - t2))
            b1 = a1 * ((t2 - t) / (t2 - t0)) + a2 * ((t - t0) / (t2 - t0))
            b2 = a2 * ((t3 - t) / (t3 - t1)) + a3 * ((t - t1) / (t3 - t1))
            out.append(b1 * ((t2 - t) / (t2 - t1)) + b2 * ((t - t1) / (t2 - t1)))
    out.append(pts[-2])
    return out


def _frames(path):
    """Parallel-transport frames (tangent, normal, binormal) along a polyline."""
    tans = []
    for i in range(len(path)):
        a = path[max(0, i - 1)]
        b = path[min(len(path) - 1, i + 1)]
        tans.append((b - a).normalized())
    ref = Vector((0, 0, 1)) if abs(tans[0].z) < 0.9 else Vector((1, 0, 0))
    n = (ref - tans[0] * ref.dot(tans[0])).normalized()
    frames = []
    for i, t in enumerate(tans):
        if i:
            n = n - t * n.dot(t)
            n = n.normalized() if n.length > 1e-9 else frames[-1][1]
        frames.append((t, n, t.cross(n)))
    return frames


def _arc(path):
    s = [0.0]
    for a, b in zip(path, path[1:]):
        s.append(s[-1] + (b - a).length)
    return s


def tube(bm, path, radius, mi, sides=6, uv_layer=None):
    """Closed-ring tube (open ends) along `path`; UV in metres."""
    frames = _frames(path)
    arc = _arc(path)
    rings = []
    for p, (t, n, b) in zip(path, frames):
        rings.append([bm.verts.new(p + (n * math.cos(a) + b * math.sin(a)) * radius)
                      for a in (2 * math.pi * k / sides for k in range(sides))])
    circ = 2 * math.pi * radius
    for i in range(len(rings) - 1):
        for k in range(sides):
            j = (k + 1) % sides
            f = bm.faces.new((rings[i][k], rings[i][j], rings[i + 1][j], rings[i + 1][k]))
            f.material_index = mi
            f.smooth = True
            if uv_layer is not None:
                for loop, (s, v) in zip(f.loops, ((arc[i], k), (arc[i], k + 1),
                                                  (arc[i + 1], k + 1), (arc[i + 1], k))):
                    loop[uv_layer].uv = (s, v / sides * circ)
    return arc


def _ring(bm, centre, frame, r_in, width, thick, mi, sides=10):
    """Cable tie: flat strap ring (rectangular cross-section) around the bundle,
    plus the little locking head."""
    t, n, b = frame
    verts = []
    for k in range(sides):
        a = 2 * math.pi * k / sides
        d = n * math.cos(a) + b * math.sin(a)
        verts.append([bm.verts.new(centre + d * r + t * w)
                      for r, w in ((r_in, -width / 2), (r_in, width / 2),
                                   (r_in + thick, width / 2), (r_in + thick, -width / 2))])
    for k in range(sides):
        q0, q1 = verts[k], verts[(k + 1) % sides]
        for e in range(4):
            f = bm.faces.new((q0[e], q0[(e + 1) % 4], q1[(e + 1) % 4], q1[e]))
            f.material_index = mi
    # locking head
    hc = centre + n * (r_in + thick + 0.0015)
    bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.LocRotScale(
        hc, Matrix((t, b, n)).transposed().to_quaternion(), (width * 1.6, 0.006, 0.004)))


def _hex_offsets(n, d):
    """Packed cable positions (2D) for n cables of diameter d."""
    pts = [(0.0, 0.0)]
    ring = 1
    while len(pts) < n:
        for k in range(6 * ring):
            a = 2 * math.pi * k / (6 * ring)
            pts.append((math.cos(a) * d * ring, math.sin(a) * d * ring))
        ring += 1
    return pts[:n]


def cable_bundle(name, ctrl, starts, ends, mat, cable_r=0.003, collection=None):
    """One bundle: Catmull-Rom centre line through `ctrl` (sag included in the
    control points), one cable per (start, end) port pair, fanning out over the
    first/last 12 cm, RJ45 boots at both ends, ties every TIE_SPACING."""
    centre = catmull_rom(ctrl)
    arc = _arc(centre)
    total = arc[-1]
    frames = _frames(centre)
    n = len(starts)
    offs = _hex_offsets(n, cable_r * 2.05)
    bundle_r = max(math.hypot(*o) for o in offs) + cable_r
    fan = min(0.12, total * 0.3)

    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    mats = [mat, "plastic_black", "boot_clear"]

    def smooth(x):
        return x * x * (3 - 2 * x)

    for ci in range(n):
        ox, oy = offs[ci]
        tw = 0.6 * ci                     # slight individual twist phase
        s0, e0 = Vector(starts[ci]), Vector(ends[ci])
        path = []
        for p, s, (t, nn, bb) in zip(centre, arc, frames):
            a = 2 * math.pi * s / 0.9 + tw   # one twist per 0.9 m
            o = (nn * (ox * math.cos(a) - oy * math.sin(a)) +
                 bb * (ox * math.sin(a) + oy * math.cos(a)))
            q = p + o
            if s < fan:                   # fan out to the own port
                w = smooth(1 - s / fan)
                q = q.lerp(s0 + (p - centre[0]), w)
            elif s > total - fan:
                w = smooth((s - (total - fan)) / fan)
                q = q.lerp(e0 + (p - centre[-1]), w)
            path.append(q)
        path[0], path[-1] = s0, e0
        tube(bm, path, cable_r, 0, sides=6, uv_layer=uvl)
        for end, nxt in ((path[0], path[1]), (path[-1], path[-2])):   # RJ45 boot
            d = (nxt - end).normalized()
            rot = d.to_track_quat("Z", "Y")
            m = Matrix.LocRotScale(end + d * 0.010, rot, (0.0118, 0.0085, 0.020))
            r0 = len(bm.faces)
            bmesh.ops.create_cube(bm, size=1.0, matrix=m)
            bm.faces.ensure_lookup_table()
            for f in bm.faces[r0:]:
                f.material_index = 2
    # cable ties along the bundled section
    ties = []
    s = fan + 0.04
    while s < total - fan - 0.02:
        ties.append(s)
        s += TIE_SPACING
    if not ties:                          # short bundle: one tie in the middle
        ties = [total / 2]
    for s_t in ties:
        i = min(range(len(arc)), key=lambda k: abs(arc[k] - s_t))
        r0 = len(bm.faces)
        _ring(bm, centre[i], frames[i], bundle_r + 0.0003, 0.0045, 0.0012, 1)
        bm.faces.ensure_lookup_table()
        for f in bm.faces[r0:]:
            f.material_index = 1
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(materials.get(m))
    obj = bpy.data.objects.new(name, me)
    (collection or bpy.context.scene.collection).objects.link(obj)
    obj["leyonet_kind"] = "cable"
    obj["cable_length_m"] = round(total, 3)
    obj["cable_ties"] = len(ties)
    # tie / boot faces got box UVs in metres too
    uvtools_box_missing(obj)
    return obj


def uvtools_box_missing(obj):
    """Box-project only faces whose UVs are all zero (cubes from bmesh.ops)."""
    me = obj.data
    uv = me.uv_layers["UVMap"]
    mw = Matrix.Identity(4)
    for p in me.polygons:
        if all(uv.data[li].uv.length == 0 for li in p.loop_indices):
            n = p.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            a, b = [i for i in range(3) if i != ax]
            for li in p.loop_indices:
                co = mw @ me.vertices[me.loops[li].vertex_index].co
                uv.data[li].uv = (co[a], co[b])


# --- patch cords in the network rack ---------------------------------------------------
def _pp_port_x(block, col):
    span = 24 * 0.0165 + 3 * 0.0080
    return -span / 2 + block * (6 * 0.0165 + 0.0080) + col * 0.0165 + 0.0165 / 2


def _sw_port_x(block, col):
    return -0.1600 + block * (6 * 0.0145 + 0.0080) + col * 0.0145 + 0.0145 / 2


def build_patch_bundles(rack, pairs=((42, 41, 0, "cable_blue"), (40, 39, 1, "cable_yellow"),
                                     (38, 37, 2, "cable_grey")), n=6):
    """3 bundles patch panel -> switch below it, each n cords from one 6-port
    block, routed out to the left rack edge with a service-loop sag below the
    switch. Built in rack space and parented to `rack`."""
    yfr = rack["y_front_rail"]
    out = []
    for k, (u_pp, u_sw, blk, mat) in enumerate(pairs):
        zp = u_bottom(rack, u_pp) + 0.0146          # keystone opening centre
        zs = u_bottom(rack, u_sw) + 0.0265          # top RJ45 row centre
        yp = yfr - 0.0020 - 0.0015 - 0.0005          # in front of the keystones
        ys = yfr - 0.0025 - 0.0006
        starts = [(_pp_port_x(blk, c), yp, zp) for c in range(n)]
        ends = [(_sw_port_x(blk, c), ys, zs) for c in range(n)]
        xs = sum(p[0] for p in starts) / n
        xe = sum(p[0] for p in ends) / n
        x_edge = -0.214 + 0.004 * k
        sag = 0.075 + 0.02 * k                       # service loop below the switch
        ctrl = [
            (xs, yp - 0.030, zp - 0.004),
            ((xs + x_edge) / 2, yfr - 0.070, zp - 0.012),
            (x_edge, yfr - 0.080, zs - sag * 0.55),
            (x_edge + 0.020, yfr - 0.078, zs - sag),        # lowest point
            ((x_edge + xe) / 2, yfr - 0.072, zs - sag * 0.65),
            (xe, ys - 0.032, zs - 0.006),
        ]
        o = cable_bundle(f"{rack.name}_patch_bundle_{k + 1}", ctrl, starts, ends, mat)
        o.parent = rack
        o.matrix_parent_inverse.identity()
        out.append(o)
    return out


# --- props --------------------------------------------------------------------------------
def _cyl_z(bm, cx, cy, z0, z1, r, mi, seg=24, r_top=None):
    m = Matrix.Translation((cx, cy, (z0 + z1) / 2))
    res = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg,
                                radius1=r, radius2=r if r_top is None else r_top,
                                depth=z1 - z0, matrix=m)
    for v in res["verts"]:
        for f in v.link_faces:
            f.material_index = mi
    return res


def _finish(bm, name, mats, kind="room", collection=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(materials.get(m))
    obj = bpy.data.objects.new(name, me)
    (collection or bpy.context.scene.collection).objects.link(obj)
    obj["leyonet_kind"] = kind
    return obj


def _part(bm, mi, fn):
    """Run fn() (adds geometry to bm) and give every new face material `mi`."""
    bm.faces.ensure_lookup_table()
    r0 = len(bm.faces)
    fn()
    bm.faces.ensure_lookup_table()
    for f in bm.faces[r0:]:
        f.material_index = mi


def _cube(bm, loc, size, rot=None):
    bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.LocRotScale(loc, rot, size))


def build_fire_extinguisher(loc=(3.985, 0.75, 0.0), name="fire_extinguisher"):
    """6 kg powder extinguisher on a wall bracket, mounted on the right wall
    (+x wall, facing -x). Handle at ~1.15 m (ASR A2.2: 0.8-1.2 m)."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    mats = ["extinguisher_red", "steel_zinc", "plastic_black", "label_white"]
    r, z0, h = 0.080, 0.58, 0.44
    cx = -r - 0.035                                  # local x: wall at 0, body in front of it
    zt = z0 + h
    _part(bm, 0, lambda: _cyl_z(bm, cx, 0, z0, zt, r, 0, seg=28))
    _part(bm, 0, lambda: _cyl_z(bm, cx, 0, zt, zt + 0.040, r, 0, seg=28, r_top=0.030))  # shoulder
    _part(bm, 1, lambda: _cyl_z(bm, cx, 0, zt + 0.040, zt + 0.095, 0.017, 1, seg=16))   # valve
    _part(bm, 2, lambda: _cyl_z(bm, cx, 0, z0 - 0.004, z0 + 0.012, r + 0.002, 2, seg=28))  # foot ring
    _part(bm, 1, lambda: _cube(bm, (cx - 0.050, 0, zt + 0.078), (0.110, 0.024, 0.006)))  # carry handle
    _part(bm, 2, lambda: _cube(bm, (cx - 0.045, 0, zt + 0.102), (0.100, 0.022, 0.007)))  # lever
    _part(bm, 1, lambda: bmesh.ops.create_cone(
        bm, cap_ends=True, segments=16, radius1=0.015, radius2=0.015, depth=0.008,
        matrix=Matrix.LocRotScale((cx - 0.020, 0, zt + 0.064),
                                  Matrix.Rotation(math.pi / 2, 3, "Y").to_quaternion(), (1, 1, 1))))
    _part(bm, 3, lambda: _cube(bm, (cx - r + 0.010, 0, z0 + h * 0.52), (0.006, 0.105, 0.17)))  # label
    _part(bm, 1, lambda: _cube(bm, (-0.004, 0, z0 + h * 0.78), (0.008, 0.060, 0.130)))  # wall plate
    _part(bm, 1, lambda: _cube(bm, (-0.022, 0, z0 + h * 0.78), (0.036, 0.034, 0.030)))  # hook
    _part(bm, 2, lambda: _cube(bm, (cx - r - 0.002, -0.058, z0 + 0.13), (0.012, 0.016, 0.03)))  # hose clip
    # hose: Catmull-Rom from the valve, sagging down the front into the clip
    hose = catmull_rom([(cx - 0.012, -0.014, zt + 0.072), (cx - 0.045, -0.050, zt + 0.030),
                        (cx - 0.070, -0.072, zt - 0.080), (cx - 0.074, -0.068, z0 + 0.22),
                        (cx - r - 0.002, -0.058, z0 + 0.14)])
    tube(bm, hose, 0.0075, 2, sides=8, uv_layer=uvl)
    obj = _finish(bm, name, mats)
    uvtools.box_project_aligned(obj, 1.0)
    obj.location = loc
    return obj


def build_exit_sign(loc=(3.40, 0.0, 2.30), name="exit_sign"):
    """Backlit emergency-exit sign above the door (ISO 7010 E001 + arrow), on
    the front wall interior face (y = 0), facing +y. 30 x 15 cm, 3 cm deep."""
    mb = MeshBuilder(name)
    w, h, d = 0.30, 0.15, 0.030
    mb.box(-w / 2, w / 2, 0.0, d, -h / 2, h / 2, "sign_housing", skip=("-y",))
    yf = d + 0.0005
    mb.box(-w / 2 + 0.008, w / 2 - 0.008, d, yf, -h / 2 + 0.008, h / 2 - 0.008, "sign_green")
    yp = yf + 0.0004

    def q(x0, x1, z0, z1):                     # white pictogram element (faces +y)
        mb.box(x0, x1, yf, yp, z0, z1, "sign_white", skip=("-y",))

    # door (right half): frame outline + opening
    dx0, dx1, dz0, dz1 = 0.020, 0.105, -0.055, 0.055
    q(dx0, dx1, dz1 - 0.008, dz1)
    q(dx0, dx0 + 0.008, dz0, dz1)
    q(dx1 - 0.008, dx1, dz0, dz1)
    # running figure (left of the door, moving right): head, torso, arms, legs
    fx = -0.020
    q(fx - 0.007, fx + 0.007, 0.030, 0.044)             # head
    q(fx - 0.012, fx + 0.002, -0.005, 0.026)            # torso (leaning)
    q(fx + 0.002, fx + 0.026, 0.012, 0.019)             # front arm
    q(fx - 0.032, fx - 0.012, 0.004, 0.011)             # back arm
    q(fx - 0.004, fx + 0.020, -0.020, -0.013)           # front thigh
    q(fx + 0.014, fx + 0.021, -0.050, -0.016)           # front shin
    q(fx - 0.030, fx - 0.008, -0.012, -0.005)           # back thigh
    q(fx - 0.038, fx - 0.030, -0.040, -0.008)           # back shin
    # arrow (left part) pointing to the door
    q(-0.130, -0.075, -0.004, 0.004)
    for k in range(5):                         # arrow head: stepped triangle
        q(-0.080 + k * 0.004, -0.076 + k * 0.004, -0.022 + k * 0.0045, 0.022 - k * 0.0045)
    # wall bracket
    mb.box(-0.06, 0.06, -0.0, 0.004, h / 2, h / 2 + 0.02, "steel_zinc")
    obj = mb.finish("room")
    obj.location = loc
    return obj


def build_carton(loc=(3.45, 3.95, 0.0), size=(0.50, 0.38, 0.34), rot_z=0.22, name="carton"):
    """Closed shipping carton on the raised floor: body, top flap seam, packing tape."""
    mb = MeshBuilder(name)
    sx, sy, sz = size
    mb.box(-sx / 2, sx / 2, -sy / 2, sy / 2, 0.0, sz, "cardboard", skip=("-z",))
    mb.box(-sx / 2, sx / 2, -0.0012, 0.0012, sz, sz + 0.0004, "port_black")        # flap seam
    mb.box(-sx / 2 - 0.0008, sx / 2 + 0.0008, -0.025, 0.025, sz + 0.0004, sz + 0.0010, "tape")
    for s in (-1, 1):                                                               # tape down the ends
        mb.box(s * sx / 2, s * (sx / 2 + 0.0008), -0.025, 0.025, sz - 0.07, sz + 0.0010, "tape")
    obj = mb.finish("room")
    obj.location = loc
    obj.rotation_euler = (0, 0, rot_z)
    return obj


def build_wall_display(loc=(8.0, 3.0, 1.55), size=(2.20, 1.2375), name="wall_display"):
    """Plan v4 I: Wandbildschirm (98 Zoll, 16:9) an der rechten Wand (x = loc.x, Blick -x): Gehaeuse, schmaler
    Rahmen, Wandhalter, Standby-LED. Returns (body, screen); auf `<name>_screen` zeichnet das Spiel den Netzplan."""
    w, h = size
    hw, hh, b = w / 2, h / 2, 0.012
    mb = MeshBuilder(name)
    x1 = -0.030                                                     # Wandabstand (Halter)
    mb.box(x1 - 0.030, x1, -hw, hw, -hh, hh, "plastic_black")       # Gehaeuse
    xf = x1 - 0.030
    for y0, y1, z0, z1 in ((-hw - b, hw + b, hh, hh + b), (-hw - b, hw + b, -hh - 2 * b, -hh),
                           (-hw - b, -hw, -hh, hh), (hw, hw + b, -hh, hh)):     # Rahmen (unten breiter)
        mb.box(xf - 0.004, x1, y0, y1, z0, z1, "painted_steel")
    for yy in (-0.35, 0.35):                                        # Wandhalter
        mb.box(x1, 0.0, yy - 0.03, yy + 0.03, -0.25, 0.25, "steel_zinc", skip=("+x",))
    mb.box(xf - 0.0046, xf - 0.004, hw - 0.060, hw - 0.054, -hh - 0.015, -hh - 0.011, "led_green")
    body = mb.finish("room")
    sb = MeshBuilder(f"{name}_screen")
    sb.box(xf - 0.0012, xf, -hw, hw, -hh, hh, "screen_dark", skip=("+x",))
    screen = sb.finish("room")
    for o in (body, screen):
        uvtools.box_project(o, 1.0)
        o.location = loc
    return body, screen


def build_light_switch(loc=(7.42, 0.0, 1.10), name="light_switch_1"):
    """Plan v4: Lichtschalter (Aufputz, 86 x 86 mm, zwei Wippen) an der vorderen Wand (y = loc.y, Blick +y)."""
    mb = MeshBuilder(name)
    s = 0.043
    mb.box(-s, s, 0.0, 0.010, -s, s, "switch_white", skip=("-y",))              # Rahmen
    for x0, x1 in ((-0.031, -0.001), (0.001, 0.031)):                             # zwei Wippen
        mb.box(x0, x1, 0.010, 0.0135, 0.001, 0.031, "switch_white", skip=("-y",))
        mb.box(x0, x1, 0.010, 0.0155, -0.031, 0.001, "switch_white", skip=("-y",))
    mb.box(0.0145, 0.0175, 0.0155, 0.0158, -0.026, -0.023, "led_amber", skip=("-y",))   # Orientierungslicht
    obj = mb.finish("room")
    uvtools.box_project(obj, 1.0)
    obj.location = loc
    return obj


def build_service_pole(loc, z0=0.74, z1=3.0, name="service_pole"):
    """Plan v4 D: Energiesaeule vom Pult zur Decke - fuehrt die Leitung der Tischdose in die Gitterrinne.
    Alu-Profil 60 x 60 mm mit Fuss- und Deckenflansch, Deckelfuge und Kabelauslass auf Rinnenhoehe."""
    mb = MeshBuilder(name)
    h = 0.030
    mb.box(-h, h, -h, h, z0, z1, "window_alu")
    for a, b in ((z0, z0 + 0.008), (z1 - 0.008, z1)):
        mb.box(-0.055, 0.055, -0.055, 0.055, a, b, "window_alu")
    mb.box(-0.020, 0.020, -h - 0.0015, -h, z0 + 0.010, z1 - 0.010, "plastic_grey", skip=("+y",))        # Deckel
    mb.box(-0.024, 0.024, -h - 0.0060, -h - 0.0015, 2.31, 2.40, "plastic_black", skip=("+y",))           # Kabelauslass
    obj = mb.finish("room")
    uvtools.box_project_aligned(obj, 1.0)
    obj.location = (loc[0], loc[1], 0.0)
    return obj


POWER_BOX_H = 0.125     # Unterkante der Verschraubungen unter der Decke


def build_power_box(loc, z_ceiling=3.0, name="power_box_a"):
    """Abgangskasten an der Decke: lackiertes Blechgehaeuse mit Flansch, Deckelfuge und 2 x 4 Verschraubungen unten.
    Von hier fuehrt das Spiel die Zuleitungen (A/B) in die Racks. loc = Mitte (x, y); das Spiel kennt das Raster (30 x 21 mm)."""
    mb = MeshBuilder(name)
    z0 = z_ceiling - POWER_BOX_H + 0.015
    mb.box(-0.095, 0.095, -0.060, 0.060, z_ceiling - 0.006, z_ceiling, "painted_steel")                   # Flansch
    mb.box(-0.080, 0.080, -0.050, 0.050, z0, z_ceiling - 0.006, "painted_steel")
    mb.box(-0.072, 0.072, -0.0515, -0.050, z0 + 0.008, z_ceiling - 0.014, "painted_steel", skip=("+y",))  # Deckel
    for i in range(4):
        for k in range(2):
            cx, cy = (k - 0.5) * 0.030, (i - 1.5) * 0.014 * 1.5
            mb.box(cx - 0.0085, cx + 0.0085, cy - 0.0085, cy + 0.0085, z0 - 0.015, z0, "plastic_black")   # Verschraubung
    obj = mb.finish("room")
    uvtools.box_project_aligned(obj, 1.0)
    obj.location = (loc[0], loc[1], 0.0)
    return obj


def build_sprinkler(x, y0, y1, z=2.90, z_ceiling=3.0, name="sprinkler_1"):
    """Ref-Vergleich 2026-11-23 (ref_pdc_server_room): Sprinklerrohr unter der Decke (verzinkt, 42 mm), Rohrschellen
    alle 1.5 m, Sprinklerkoepfe alle 2 m, Endkappen."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    r = 0.021
    path = [Vector((x, y0 + (y1 - y0) * k / 12, z)) for k in range(13)]
    tube(bm, path, r, 0, sides=16, uv_layer=uvl)
    for yy, d in ((y0, -1), (y1, 1)):
        _part(bm, 0, lambda: bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=r + 0.004, radius2=r + 0.004, depth=0.03,
              matrix=Matrix.LocRotScale((x, yy + d * 0.005, z), Matrix.Rotation(math.pi / 2, 3, "X").to_quaternion(), (1, 1, 1))))
    yy = y0 + 0.5
    while yy < y1:
        _part(bm, 0, lambda: _cube(bm, (x, yy, z), (0.054, 0.024, 0.054)))                          # Schelle
        _part(bm, 0, lambda: _cyl_z(bm, x, yy, z + 0.02, z_ceiling, 0.005, 0, seg=8))                 # Gewindestange
        yy += 1.5
    yy = y0 + 1.0
    while yy < y1:
        _part(bm, 1, lambda: _cyl_z(bm, x, yy, z - 0.055, z - 0.015, 0.010, 1, seg=12))               # Kopf
        _part(bm, 1, lambda: _cyl_z(bm, x, yy, z - 0.072, z - 0.069, 0.017, 1, seg=12))               # Prallteller
        _part(bm, 2, lambda: _cyl_z(bm, x, yy, z - 0.069, z - 0.055, 0.003, 2, seg=8))                # Glasampulle
        yy += 2.0
    obj = _finish(bm, name, ["steel_zinc", "contact_gold", "sign_green"])
    uvtools.box_project_aligned(obj, 1.0)
    return obj
