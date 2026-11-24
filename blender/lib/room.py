"""SMB (KMU) server room, 4 x 5 m, 3 m clear height.

Layout (room space, metres; x = width 0..4, y = depth 0..5, z = up):

    y=5 +--------------------------------------+
        | hot  |  rack row  | cold aisle |  walk |
        | aisle|  4 x 42U   | (contained)|  way  |
        | 0.6  | x 0.6..1.6 | x 1.6..2.8 | ..4.0 |
        |      | y 1.3..3.7 |            |       |
    y=0 +---------------------------- [door] --+
        x=0                          2.9..3.9   x=4

- raised floor: 600 mm tiles as geometry (HPL top, PVC edges, 2 mm joints),
  perforated vent tiles in the cold aisle, worn tiles on the walking path,
  dark subfloor slab below (floor recessed, so tile top = door threshold z=0)
- walls: fair-faced concrete, one object per wall
- ceiling: white paint, 3 surface-mounted LED bands (emissive diffuser)
Materials: ambientCG texture sets (lib.textures), UV0 in metres; all room
objects get a 2 mm / 3 segment bevel (Realismus-Regel 1).
- door: steel frame + leaf with vision panel (separate glass object)
- cold aisle containment: aluminium frame, polycarbonate roof + side wall,
  sliding double doors at both ends (separate glass object)
All objects carry leyonet_kind; build_room_smb() returns the bake grouping.
"""
import math

import bpy
from mathutils import Vector

from . import devices, uvtools
from .devices import MeshBuilder

W, D, H = 4.0, 5.0, 3.0
WALL_T = 0.20
DOOR_X0, DOOR_X1, DOOR_H = 2.90, 3.90, 2.10
RACK_FRONT_X, AISLE_X1 = 1.60, 2.80
ROW_Y0, N_RACKS = 1.30, 4
ROW_Y1 = ROW_Y0 + 0.6 * N_RACKS
LED_X = (0.45, 2.20, 3.40)

# outward normals, used for cut-away renders
WALL_NORMALS = {"wall_front": (0, -1, 0), "wall_back": (0, 1, 0),
                "wall_left": (-1, 0, 0), "wall_right": (1, 0, 0)}

# self-check camera views: name -> (location, target, lens mm)
VIEWS = {
    "view_door":      ((3.55, 0.35, 1.65), (1.80, 3.20, 1.05), 16),
    "view_coldaisle": ((2.25, 1.45, 1.60), (1.85, 3.70, 0.95), 16),
    "view_hotaisle":  ((0.32, 0.35, 1.60), (0.55, 4.20, 0.95), 16),
    "view_corner":    ((3.70, 4.75, 2.45), (1.50, 1.00, 0.70), 16),
}


def _tag(obj, kind="room"):
    obj["leyonet_kind"] = kind
    return obj


def build_room_shell(w=W, d=D, h=H, door=(DOOR_X0, DOOR_X1, DOOR_H)):
    """Ceiling and four walls (front wall with a door opening); the floor is
    build_raised_floor().
    Returns {name: obj}."""
    t = WALL_T
    out = {}

    # Only faces visible from inside are built (outer and buried faces would
    # waste lightmap space).
    mb = MeshBuilder("ceiling")
    mb.box(-t, w + t, -t, d + t, h, h + 0.20, "ceiling_paint", skip=("+z", "-x", "+x", "-y", "+y"))
    out["ceiling"] = mb.finish("room")
    uvtools.box_project(out["ceiling"], 1.0)

    hidden = ("+z", "-z")
    zb = -0.32                                  # walls reach down to the subfloor slab
    walls = {
        "wall_back": [((0, w, d, d + t, zb, h), ("+y", "-x", "+x") + hidden)],
        "wall_left": [((-t, 0, -t, d + t, zb, h), ("-x", "-y", "+y") + hidden)],
        "wall_right": [((w, w + t, -t, d + t, zb, h), ("+x", "-y", "+y") + hidden)],
    }
    if door:
        x0, x1, dh = door
        walls["wall_front"] = [((0, x0, -t, 0, zb, h), ("-y", "-x") + hidden),
                               ((x1, w, -t, 0, zb, h), ("-y", "+x") + hidden),
                               ((x0, x1, -t, 0, dh, h), ("-y", "-x", "+x", "+z"))]
    else:
        walls["wall_front"] = [((0, w, -t, 0, zb, h), ("-y", "-x", "+x") + hidden)]
    for name, boxes in walls.items():
        mb = MeshBuilder(name)
        for b, skip in boxes:
            mb.box(*b, "wall_concrete", skip=skip)
        out[name] = mb.finish("room")
        uvtools.box_project(out[name], 1.0)
    return out


def build_door(x0=DOOR_X0, x1=DOOR_X1, height=DOOR_H, wall_t=WALL_T):
    """Steel door in the front wall (y = 0 is the interior wall face): wrap-around
    frame, leaf with vision panel, lever handles both sides.
    Returns (door_obj, glass_obj)."""
    mb = MeshBuilder("door")
    f = 0.05                                    # frame profile
    yo, yi = -wall_t - 0.01, 0.012              # frame lips outside / inside
    for (a, b) in ((x0, x0 + f), (x1 - f, x1)):  # jambs
        mb.box(a, b, yo, yi, 0.0, height, "door_painted_worn")
    mb.box(x0 + f, x1 - f, yo, yi, height - f, height, "door_painted_worn")   # head (between jambs)
    for y0, y1 in ((0.0, yi), (yo, -wall_t)):                       # architraves, butt-jointed
        mb.box(x0 - 0.05, x0, y0, y1, 0.0, height, "door_painted_worn")
        mb.box(x1, x1 + 0.05, y0, y1, 0.0, height, "door_painted_worn")
        mb.box(x0 - 0.05, x1 + 0.05, y0, y1, height, height + 0.05, "door_painted_worn")

    lx0, lx1, lz0, lz1 = x0 + f + 0.005, x1 - f - 0.005, 0.008, height - f - 0.004
    ly0, ly1 = -0.065, -0.020                   # 45 mm leaf, interior face at y=-0.02
    gx0, gx1, gz0, gz1 = x0 + 0.27, x1 - 0.27, 1.05, 1.85    # vision panel opening
    for b in ((lx0, lx1, lz0, gz0), (lx0, lx1, gz1, lz1),
              (lx0, gx0, gz0, gz1), (gx1, lx1, gz0, gz1)):
        mb.box(b[0], b[1], ly0, ly1, b[2], b[3], "door_painted_worn")
    for yb in ((ly1, ly1 + 0.008), (ly0 - 0.008, ly0)):            # glazing beads
        for b in ((gx0 - 0.02, gx1 + 0.02, gz0 - 0.02, gz0), (gx0 - 0.02, gx1 + 0.02, gz1, gz1 + 0.02),
                  (gx0 - 0.02, gx0, gz0, gz1), (gx1, gx1 + 0.02, gz0, gz1)):
            mb.box(b[0], b[1], yb[0], yb[1], b[2], b[3], "door_painted_worn")
    # lever handles (hinge on the left, handle right), rosette + neck + lever
    hx, hz = lx1 - 0.075, 1.05
    for side in (1, -1):
        yface = ly1 if side > 0 else ly0
        if side > 0:
            mb.cyl_y(hx, hz, 0.026, yface, 0.010, "brushed_steel_fingerprints", seg=16, cap="back")
            mb.cyl_y(hx, hz, 0.010, yface, 0.060, "brushed_steel_fingerprints", seg=10, cap="back")
            mb.box(hx - 0.13, hx + 0.012, yface + 0.050, yface + 0.068, hz - 0.011, hz + 0.011, "brushed_steel_fingerprints")
        else:
            mb.cyl_y(hx, hz, 0.026, yface - 0.010, 0.010, "brushed_steel_fingerprints", seg=16)
            mb.cyl_y(hx, hz, 0.010, yface - 0.060, 0.060, "brushed_steel_fingerprints", seg=10)
            mb.box(hx - 0.13, hx + 0.012, yface - 0.068, yface - 0.050, hz - 0.011, hz + 0.011, "brushed_steel_fingerprints")
    mb.box(lx0 + 0.05, lx0 + 0.45, ly1, ly1 + 0.05, lz1 - 0.06, lz1 - 0.01, "door_painted_worn")  # closer
    door = mb.finish("room")

    mb = MeshBuilder("door_glass")
    mb.box(gx0, gx1, -0.046, -0.040, gz0, gz1, "glass_smudged")
    glass = mb.finish("room_glass")
    return door, glass


def build_led_band(name, x, y0=0.6, y1=4.4, z_ceiling=H):
    """Surface-mounted LED band: aluminium profile 60 x 30 mm, opal diffuser."""
    mb = MeshBuilder(name)
    mb.box(x - 0.030, x + 0.030, y0, y1, z_ceiling - 0.030, z_ceiling, "brushed_steel")
    mb.box(x - 0.024, x + 0.024, y0 + 0.006, y1 - 0.006, z_ceiling - 0.034, z_ceiling - 0.030,
           "led_diffuser", skip=("+z",))
    for yy in (y0 - 0.004, y1):
        mb.box(x - 0.031, x + 0.031, yy, yy + 0.004, z_ceiling - 0.035, z_ceiling, "tile_edge_pvc")
    return mb.finish("room")


# Kaltgang-Einhausung (Glas): seit 2026-11-19 standardmaessig AUS - der Raum soll direkt der
# Serverraum sein (User-Entscheid). Builder bleibt erhalten, CONTAINMENT = True baut sie wieder ein.
CONTAINMENT = False


def build_cold_aisle_containment(x0=RACK_FRONT_X, x1=AISLE_X1, y0=ROW_Y0, y1=ROW_Y1,
                                 z_top=2.0015, bay=0.6):
    """Cold aisle containment in front of a single rack row: roof, side wall and a
    sliding double door at each end. Returns (frame_obj, glass_obj)."""
    fr = MeshBuilder("containment_frame")
    gl = MeshBuilder("containment_glass")
    p = 0.04
    zr = z_top + 0.05
    # roof frame
    fr.box(x0, x0 + p, y0, y1, z_top, zr, "brushed_steel")
    fr.box(x1 - p, x1, y0, y1, z_top, zr, "brushed_steel")
    bars = [y0 + k * bay for k in range(int(round((y1 - y0) / bay)) + 1)]
    for k, yb in enumerate(bars):
        a = yb if k == 0 else (yb - p if k == len(bars) - 1 else yb - p / 2)
        fr.box(x0 + p, x1 - p, a, a + p, z_top, zr, "brushed_steel")
    for ya, yb in zip(bars[:-1], bars[1:]):
        gl.box(x0 + p, x1 - p, ya + p / 2, yb - p / 2, z_top + 0.020, z_top + 0.026, "polycarbonate_smudged")
    # side wall at x1: posts, kick plate, panes
    posts = [y0, (y0 + y1) / 2 - p / 2, y1 - p]
    for yp in posts:
        fr.box(x1 - p, x1, yp, yp + p, 0.0, z_top, "brushed_steel")
    for ya, yb in zip(posts[:-1], posts[1:]):                       # kick plates between posts
        fr.box(x1 - 0.030, x1 - 0.010, ya + p, yb, 0.0, 0.12, "painted_steel")
    for ya, yb in ((posts[0] + p, posts[1]), (posts[1] + p, posts[2])):
        gl.box(x1 - 0.024, x1 - 0.016, ya, yb, 0.12, z_top, "polycarbonate_smudged")
    # end doors (sliding pair); outward = -y at y0, +y at y1
    for yend, out in ((y0, -1), (y1, 1)):
        def yy(a, b):          # offset range outward from the end plane
            return (yend + out * a, yend + out * b)
        fr.box(x0, x0 + p, *yy(0.0, 0.085), 0.0, zr, "brushed_steel")               # door posts
        fr.box(x1 - p, x1, *yy(0.0, 0.085), 0.0, zr, "brushed_steel")
        fr.box(x0 + p, x1 - p, *yy(0.0, 0.085), z_top - 0.03, zr, "brushed_steel")  # header / track
        mid = (x0 + x1) / 2
        leaves = ((x0 + p, mid + 0.015, 0.020, 0.040), (mid - 0.015, x1 - p, 0.050, 0.070))
        for lx0, lx1, da, db in leaves:
            q = 0.035
            zb0, zb1 = 0.010 + q, z_top - 0.03 - q
            for b in ((lx0, lx1, 0.010, zb0), (lx0, lx1, zb1, z_top - 0.03),
                      (lx0, lx0 + q, zb0, zb1), (lx1 - q, lx1, zb0, zb1)):
                fr.box(b[0], b[1], *yy(da, db), b[2], b[3], "brushed_steel")
            gl.box(lx0 + q, lx1 - q, *yy(da + 0.007, db - 0.007), 0.010 + q, z_top - 0.03 - q,
                   "polycarbonate_smudged")
            # bar handle on the outside, near the meeting edge
            hx = lx1 - 0.08 if lx0 < mid - 0.1 else lx0 + 0.06
            fr.box(hx, hx + 0.02, *yy(db, db + 0.035), 0.85, 1.25, "brushed_steel_fingerprints")
    return fr.finish("room"), gl.finish("room_glass")


def build_raised_floor(w=W, d=D, cell=0.60, origin=(RACK_FRONT_X, ROW_Y0), joint=0.002,
                       thick=0.030, void=0.30,
                       perforated=((RACK_FRONT_X, AISLE_X1), (ROW_Y0, ROW_Y1)),
                       worn=((RACK_FRONT_X, W), (0.0, ROW_Y0))):
    """Raised floor: grid aligned to the rack front / row start, tiles cut at the
    walls. Returns (tiles_obj, perforated_obj, subfloor_obj)."""
    ox, oy = origin
    xs = sorted({0.0, w} | {ox + k * cell for k in range(-20, 21) if 0.0 < ox + k * cell < w})
    ys = sorted({0.0, d} | {oy + k * cell for k in range(-20, 21) if 0.0 < oy + k * cell < d})
    solid, perf = MeshBuilder("floor_tiles"), MeshBuilder("floor_tiles_perforated")
    inside = lambda v, rng: rng[0] - 1e-6 <= v <= rng[1] + 1e-6
    for x0, x1 in zip(xs[:-1], xs[1:]):
        for y0, y1 in zip(ys[:-1], ys[1:]):
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            g = joint / 2
            a0, a1 = x0 + (g if x0 > 0 else 0), x1 - (g if x1 < w else 0)
            b0, b1 = y0 + (g if y0 > 0 else 0), y1 - (g if y1 < d else 0)
            is_perf = inside(cx, perforated[0]) and inside(cy, perforated[1])
            is_worn = inside(cx, worn[0]) and inside(cy, worn[1])
            mb = perf if is_perf else solid
            top = "floor_tile_perforated" if is_perf else ("floor_tile_hpl_worn" if is_worn else "floor_tile_hpl")
            mb.box(a0, a1, b0, b1, -thick, 0.0, top, skip=("-z", "-x", "+x", "-y", "+y"))
            mb.box(a0, a1, b0, b1, -thick, 0.0, "tile_edge_pvc", skip=("-z", "+z"))
    tiles, perf_obj = solid.finish("room"), perf.finish("room")
    for o in (tiles, perf_obj):
        uvtools.grid_project(o, origin, cell)
    mb = MeshBuilder("subfloor")
    mb.box(0, w, 0, d, -void - 0.02, -void, "subfloor_concrete", skip=("-z", "-x", "+x", "-y", "+y"))
    sub = mb.finish("room")
    uvtools.box_project(sub, 1.0)
    return tiles, perf_obj, sub


def bevel(obj, width=0.002, segments=3):
    """Realismus-Regel 1: bevel modifier (applied before lightmap unwrap/export)."""
    m = obj.modifiers.new("Bevel", "BEVEL")
    m.width = width
    m.segments = segments
    m.limit_method = "ANGLE"
    m.angle_limit = 0.5236           # 30 deg: every real edge, no coplanar seams
    m.use_clamp_overlap = True
    # flat shading: smooth + harden_normals produced blotchy normals on the
    # 600 mm tiles; 2 mm / 3 segment facets are invisible at viewing distance
    return m


# --- rack population -----------------------------------------------------------
def _populate(rack, idx):
    """Fill rack `idx` (1..4) with a plausible SMB layout + blanking panels."""
    p = f"r{idx}_"
    srv = lambda u, k: devices.mount(rack, devices.build_server_1u(f"{p}server_{k:02d}", seed=idx * 100 + k), u)
    if idx == 1:      # network rack
        for u, kind in ((42, "pp"), (41, "sw"), (40, "pp"), (39, "sw"), (38, "pp"), (37, "sw")):
            if kind == "pp":
                devices.mount(rack, devices.build_patchpanel_24(f"{p}patchpanel_U{u}"), u)
            elif u == 37:   # Plan v2: Core-Switch (Layer 3) - SSH, Routing zwischen VLANs
                devices.mount(rack, devices.build_switch_24(f"{p}coreswitch_U{u}", seed=u, core=True), u)
            else:
                devices.mount(rack, devices.build_switch_24(f"{p}switch_U{u}", seed=u), u)
        for k, u in enumerate(range(33, 29, -1)):
            srv(u, k + 1)
        # Plan v2 (Level 4/5): Firewall + Router zwischen Switches und Servern
        devices.mount(rack, devices.build_firewall_1u(f"{p}firewall_U36"), 36)
        devices.mount(rack, devices.build_router_1u(f"{p}router_U35"), 35)
        devices.mount(rack, devices.build_kvm_1u(f"{p}kvm_U34"), 34)      # KVM-Konsole (Konsolserver)
    elif idx == 2:
        for k, u in enumerate(list(range(38, 26, -1)) + list(range(12, 6, -1))):
            srv(u, k + 1)
    elif idx == 3:
        for k, u in enumerate(range(40, 20, -1)):
            srv(u, k + 1)
    else:
        for k, u in enumerate(range(35, 29, -1)):
            srv(u, k + 1)
        devices.mount(rack, devices.build_pdu(f"{p}pdu_1u", style="1u", amps="1.9"), 1)
    for side in (-1, 1):
        devices.mount_pdu_0u(rack, devices.build_pdu(f"{p}pdu_0u_{'L' if side < 0 else 'R'}",
                                                     style="0u", amps=f"{3 + idx * 0.7 + side * 0.4:.1f}"),
                             side=side)
    devices.fill_blanks(rack, max_he=2)


def build_racks(n=N_RACKS, front_x=RACK_FRONT_X, y0=ROW_Y0):
    """Rack row, fronts facing +x (into the cold aisle)."""
    racks = []
    for i in range(n):
        rack = devices.build_rack_42he(name=f"rack_{i + 1}")
        rack.location = (front_x, y0 + 0.3 + 0.6 * i, 0.0)
        rack.rotation_euler = (0.0, 0.0, math.pi / 2)
        _populate(rack, i + 1)
        racks.append(rack)
    return racks


def split_overlays(objs):
    """(lightmapped, overlays): device LED / port / display quads (lib.retrofit) are
    emissive or interaction hotspots and stay out of the lightmap atlas."""
    return [o for o in objs if "leyonet_overlay" not in o], [o for o in objs if "leyonet_overlay" in o]


def _descendants(obj):
    out, stack = [], [obj]
    while stack:
        o = stack.pop()
        out.append(o)
        stack.extend(o.children)
    return out


def build_room_smb():
    """Complete room. Returns dict with
    groups:  {bake_group: [objects]}  (lightmapped; alpha-MASK floor tiles included)
    unbaked: alpha-BLEND glazing (no lightmap)
    shell:   {name: obj} of ceiling/walls
    room_parts: every room object (beveled), racks: rack objects."""
    shell = build_room_shell()
    tiles, perf, sub = build_raised_floor()
    door, door_glass = build_door()
    leds = [build_led_band(f"led_band_{i + 1}", x) for i, x in enumerate(LED_X)]
    cont, cont_glass = build_cold_aisle_containment() if CONTAINMENT else (None, None)
    racks = build_racks()
    bpy.context.view_layer.update()
    # rack + devices: UV0 in metres from MeshBuilder.finish() (local, grain-aligned)
    uvtools.box_project(door, 1.0)
    for o in [x for x in (cont, *leds) if x]:         # brushed steel: grain along each part
        uvtools.box_project_aligned(o, 1.0)
    for o in [x for x in (door_glass, cont_glass) if x]:
        uvtools.box_project(o, 1.0)
    parts = [x for x in (*shell.values(), tiles, perf, sub, door, *leds, cont, door_glass, cont_glass) if x]
    for o in parts:
        bevel(o)
    groups = {"room": [x for x in (*shell.values(), tiles, perf, sub, door, *leds, cont) if x]}
    overlays = []
    for i, r in enumerate(racks):
        lm, ov = split_overlays(_descendants(r))
        groups[f"rack_{i + 1}"] = lm
        overlays += ov
    return {"groups": groups, "unbaked": [x for x in (door_glass, cont_glass) if x] + overlays, "shell": shell,
            "room_parts": parts, "racks": racks}


def center():
    return Vector((W / 2, D / 2, H / 2))
