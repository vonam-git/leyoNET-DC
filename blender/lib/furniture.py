"""Furniture for the server room levels: work table + notebooks (Plan v2, Level 1 / console).

Units metres, Blender Z up. Every box gets a bevel (Realismus-Regel 1): room furniture 2 mm / 3 seg.
(table), devices 0.5 mm / 2 seg. (notebook). Materials: ambientCG texture sets (lib.textures) plus
the emissive screen preset (display, like LEDs).

Notebook overlays (children, like lib.retrofit, addressed by the game):
  <nb>_port_01   RJ45 (Ethernet, left side)        leyonet_port "01", kind "rj45"
  <nb>_port_con  USB console (left side)           leyonet_port "con", kind "console"
  <nb>_screen    display quad on the lid           leyonet_overlay "screen" (game draws onto it)
The notebook object carries leyonet_kind "device", leyonet_type "notebook" (manifest role nb).
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

from . import materials, uvtools
from .devices import HOLE_OFFSETS, HOLE_PITCH_X, HOLE_SIZE, RAIL_OPENING, U, MeshBuilder

DESK_H = 0.74          # Tischhoehe (Oberkante Platte)
DESK_T = 0.03          # Plattenstaerke
NB_W, NB_D, NB_H = 0.33, 0.23, 0.018      # Notebook-Unterteil
LID_D, LID_T = 0.215, 0.006               # Deckel
LID_ANGLE = math.radians(110)             # Oeffnungswinkel (0 = zu)


def _bevel(obj, width, segments):
    m = obj.modifiers.new("Bevel", "BEVEL")
    m.width, m.segments = width, segments
    m.limit_method = "ANGLE"
    m.angle_limit = 0.5236
    m.use_clamp_overlap = True
    return m


def build_desk(name="desk_1", length=1.6, depth=0.8, height=DESK_H, collection=None):
    """Arbeitstisch: Platte (eigenes Objekt `<name>_top`, Kabel liegen darauf) + Stahlgestell
    `<name>_frame`. Lokal: Mitte der Platte in x/y, z = 0 Boden; Laenge entlang y."""
    top = MeshBuilder(f"{name}_top")
    top.box(-depth / 2, depth / 2, -length / 2, length / 2, height - DESK_T, height, "desk_hpl")
    top_obj = top.finish("furniture", collection=collection)
    fr = MeshBuilder(f"{name}_frame")
    leg, inset = 0.04, 0.05
    for sx in (-1, 1):
        for sy in (-1, 1):
            x = sx * (depth / 2 - inset)
            y = sy * (length / 2 - inset)
            fr.box(x - leg / 2, x + leg / 2, y - leg / 2, y + leg / 2, 0.0, height - DESK_T, "painted_steel")
    if length > 2.0:     # Plan v4 D: grosses Pult - mittleres Beinpaar + Querzarge gegen Durchbiegen
        for sx in (-1, 1):
            x = sx * (depth / 2 - inset)
            fr.box(x - leg / 2, x + leg / 2, -leg / 2, leg / 2, 0.0, height - DESK_T, "painted_steel")
        fr.box(-depth / 2 + inset, depth / 2 - inset, -0.015, 0.015, height - DESK_T - 0.06, height - DESK_T, "painted_steel")
    for sx in (-1, 1):   # Laengszargen unter der Platte
        x = sx * (depth / 2 - inset)
        fr.box(x - 0.015, x + 0.015, -length / 2 + inset, length / 2 - inset, height - DESK_T - 0.06,
               height - DESK_T, "painted_steel")
    fr_obj = fr.finish("furniture", collection=collection)
    for o in (top_obj, fr_obj):
        _bevel(o, 0.002, 3)
    fr_obj.parent = top_obj
    top_obj["leyonet_desk_top"] = height
    return top_obj


BENCH_HE = 6


def build_bench(name="bench_1", he=BENCH_HE, depth=0.45, collection=None):
    """Plan v4 D: offenes 19-Zoll-Tischgestell (he HE) zum Vorkonfigurieren auf dem Pult: Kufen mit Gummifuessen,
    vordere + hintere Lochschienen, Seitenholme, Querstrebe hinten. Origin: Boden, Vorderkante, Mitte x (wie das Rack,
    Front -y). Props wie das Rack: z_u1, y_front_rail, y_rear_rail, width, height."""
    mb = MeshBuilder(name)
    foot, skid = 0.006, 0.025
    z_u1 = foot + skid + 0.010
    z_top = z_u1 + he * U + 0.010
    yfr, yrr = 0.020, depth - 0.040
    x_in, x_web, x_out = RAIL_OPENING / 2, 0.2475, 0.2700
    for s in (-1, 1):
        mb.box(s * x_web, s * x_out, 0.0, depth, foot, foot + skid, "rack_powder")             # Kufe
        mb.box(s * x_web, s * x_out, yfr, yrr + 0.030, z_top, z_top + 0.020, "rack_powder")      # Seitenholm
        for yy in (0.030, depth - 0.060):
            mb.box(s * (x_web + 0.002), s * (x_out - 0.002), yy, yy + 0.030, 0.0, foot, "rubber")
        for y in (yfr, yrr):
            mb.box(s * x_web, s * x_out, y, y + 0.030, foot + skid, z_top, "rack_powder")        # Pfosten
            mb.box(s * x_in, s * x_web, y, y + 0.002, foot + skid, z_top, "steel_zinc")          # Schiene
            for u in range(he):
                for off in HOLE_OFFSETS:
                    hz, hx = z_u1 + u * U + off, s * HOLE_PITCH_X / 2
                    mb.quad_front(hx - HOLE_SIZE / 2, hx + HOLE_SIZE / 2, hz - HOLE_SIZE / 2, hz + HOLE_SIZE / 2,
                                  y - 0.0001, "hole_black")
    for zz in (foot, z_top):                                                                    # Querstreben hinten
        mb.box(-x_web, x_web, yrr + 0.004, yrr + 0.028, zz, zz + 0.020, "rack_powder")
    obj = mb.finish("bench", he=he, depth=depth, collection=collection)
    obj["z_u1"], obj["y_front_rail"], obj["y_rear_rail"] = z_u1, yfr, yrr
    obj["width"], obj["height"] = 2 * x_out, z_top + 0.020
    _bevel(obj, 0.0005, 2)
    return obj


def _side_quad(name, parent, x, y0, y1, z0, z1, facing, mat, props):
    """Quad in der YZ-Ebene bei x (Seitenflaeche), Normale facing*X (lokal am Notebook)."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in ((x, y0, z0), (x, y1, z0), (x, y1, z1), (x, y0, z1))]
    f = bm.faces.new(vs if facing > 0 else list(reversed(vs)))
    f.normal_update()
    uvl = bm.loops.layers.uv.new("UVMap")
    for loop, uvc in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uvl].uv = uvc
    bm.to_mesh(me)
    bm.free()
    me.materials.append(materials.get(mat))
    o = bpy.data.objects.new(name, me)
    parent.users_collection[0].objects.link(o)
    o.parent = parent
    for k, v in props.items():
        o[k] = v
    return o


def _top_quad(name, parent, x0, x1, y0, y1, z, mat, props):
    """Quad in der XY-Ebene bei z (Oberseite), Normale +Z (lokal am Notebook)."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    f = bm.faces.new([bm.verts.new(p) for p in ((x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z))])
    f.normal_update()
    if f.normal.z < 0:
        f.normal_flip()
    bm.to_mesh(me)
    bm.free()
    me.materials.append(materials.get(mat))
    o = bpy.data.objects.new(name, me)
    parent.users_collection[0].objects.link(o)
    o.parent = parent
    for k, v in props.items():
        o[k] = v
    return o


def _rr(u0, u1, v0, v1, r, seg=4):
    """Umriss eines Rechtecks mit gerundeten Ecken (2D, gegen den Uhrzeigersinn)."""
    pts = []
    for cu, cv, a0 in ((u1 - r, v0 + r, -90), (u1 - r, v1 - r, 0), (u0 + r, v1 - r, 90), (u0 + r, v0 + r, 180)):
        for i in range(seg + 1):
            a = math.radians(a0 + 90 * i / seg)
            pts.append((cu + r * math.cos(a), cv + r * math.sin(a)))
    return pts


def _circle(cu, cv, r, seg=12):
    return [(cu + r * math.cos(2 * math.pi * i / seg), cv + r * math.sin(2 * math.pi * i / seg)) for i in range(seg)]


def _prism(mb, pts, w0, w1, mat, axis="z"):
    """Konvexen 2D-Umriss `pts` (u, v) entlang `axis` von w0 bis w1 extrudieren, geschlossen.
    axis z: (u, v) = (x, y); y: (u, v) = (x, z); x: (u, v) = (y, z)."""
    P = {"z": lambda u, v, w: (u, v, w), "y": lambda u, v, w: (u, w, v), "x": lambda u, v, w: (w, u, v)}[axis]
    ax = Vector(P(0, 0, 1))
    mi = mb._mi(mat)
    lo = [mb.bm.verts.new(P(u, v, w0)) for u, v in pts]
    hi = [mb.bm.verts.new(P(u, v, w1)) for u, v in pts]
    cu = sum(u for u, _ in pts) / len(pts)
    cv = sum(v for _, v in pts) / len(pts)
    for ring, sign in ((lo, -1), (hi, 1)):
        f = mb.bm.faces.new(ring)
        f.material_index = mi
        f.normal_update()
        if f.normal.dot(ax * sign) < 0:
            f.normal_flip()
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        f = mb.bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
        f.material_index = mi
        f.normal_update()
        out = Vector(P((pts[i][0] + pts[j][0]) / 2 - cu, (pts[i][1] + pts[j][1]) / 2 - cv, 0))
        if f.normal.dot(out) < 0:
            f.normal_flip()


def _up(mb, x0, x1, y0, y1, z, mat):
    """Einzelnes Quad nach +Z (Beschriftung, Lochung)."""
    mb._face([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], (0, 0, 1), mb._mi(mat))


def _side(mb, x, y0, y1, z0, z1, facing, mat):
    """Einzelnes Quad in der YZ-Ebene bei x, Normale facing*X (Port-Innenleben)."""
    mb._face([(x, y0, z0), (x, y1, z0), (x, y1, z1), (x, y0, z1)], (facing, 0, 0), mb._mi(mat))


def _keyboard(mb, y_bottom):
    """Tastenkappen: Funktionsreihe + 5 Reihen (QWERTZ-Raster), Sondertasten breiter, Leertaste,
    umgekehrtes T der Pfeiltasten (hoch/runter halbe Hoehe). Jede Taste bekommt eine Beschriftung
    oben links (Flat-Quad < 1 cm), Leertaste keine."""
    pitch, gap, cap_h = 0.0190, 0.0030, 0.0011
    z0, z1 = NB_H + 0.0001, NB_H + 0.0001 + cap_h
    zl = z1 + 0.00005
    left = -0.1330

    def key(xa, xb, ya, yb, legend=True, wide=False):
        mb.box(xa + gap / 2, xb - gap / 2, ya + gap / 2, yb - gap / 2, z0, z1, "keycap")
        if legend:
            lx, ly = xa + gap / 2 + 0.0022, yb - gap / 2 - 0.0022
            lw, lh = (0.0045 if wide else 0.0026), (0.0014 if wide else 0.0028)
            _up(mb, lx, lx + lw, ly - lh, ly, zl, "key_legend")

    # Reihen von unten: Breiten in Tasteneinheiten (1u = pitch); "arrows" = Pfeilblock (3u)
    rows = [
        [1.25, 1, 1.25, 5.5, 1.25, 1, "arrows"],        # Strg Fn Alt Leertaste AltGr Strg Pfeile
        [1.25, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.75],  # Shift ... Shift
        [1.75, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.25],  # Caps ... Enter
        [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5],  # Tab ...
        [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.0],    # Ziffern + Backspace
    ]
    y = y_bottom
    for widths in rows:
        scale = 14.0 / sum(3 if w == "arrows" else w for w in widths)
        x = left
        for w in widths:
            if w == "arrows":
                u = scale * pitch
                key(x, x + u, y, y + pitch * 0.5)                                   # links
                key(x + u, x + 2 * u, y, y + pitch * 0.5)                           # runter
                key(x + u, x + 2 * u, y + pitch * 0.5, y + pitch)                   # hoch
                key(x + 2 * u, x + 3 * u, y, y + pitch * 0.5)                       # rechts
                x += 3 * u
                continue
            ww = w * scale * pitch
            key(x, x + ww, y, y + pitch, legend=w < 5, wide=w > 1.2)
            x += ww
        y += pitch
    # Funktionsreihe: halbe Hoehe, 14 Tasten (Esc F1..F12 Entf)
    for k in range(14):
        x = left + k * pitch
        mb.box(x + gap / 2, x + pitch - gap / 2, y + gap / 2, y + 0.0105, z0, z1, "keycap")
        _up(mb, x + gap / 2 + 0.0020, x + gap / 2 + 0.0050, y + 0.0105 - 0.0034, y + 0.0105 - 0.0022, zl, "key_legend")
    return y + 0.0105


def build_notebook(name="notebook_1", collection=None):
    """Notebook, aufgeklappt. Lokal: Mitte Unterteil in x, Vorderkante y = -NB_D/2 (Nutzer sitzt
    bei -Y), z = 0 Unterseite. Ports links (-X), Bildschirm auf dem Deckel.
    Detail-Pass (2026-11-20): Alu-Unibody mit gerundeten Ecken auf Gummifuessen, beschriftete
    Tastenkappen mit Pfeil-T, Touchpad mit Diamantschliff-Kante, gelochte Lautsprechergitter,
    Scharnier-Walze, Ports mit Innenleben (RJ45-Kontakte, USB-Zungen), Kartenleser, Kensington,
    duenner Display-Rahmen mit Gummidichtung, Webcam mit Linse + Kamera-LED, runder Deckel-Logo.
    Power-Taste mit Fingerabdruck-Sensor + Status-LED (<name>_led_pwr, Spiel: Strom)."""
    mb = MeshBuilder(name)
    x0, x1, y0, y1 = -NB_W / 2, NB_W / 2, -NB_D / 2, NB_D / 2
    FOOT = 0.0015
    _prism(mb, _rr(x0, x1, y0, y1, 0.007, 4), FOOT, NB_H, "laptop_alu")                    # Unterteil
    # Gummifuesse: zwei Leisten hinten, zwei runde vorne
    for sx in (-1, 1):
        _prism(mb, _rr(sx * 0.135 - 0.025, sx * 0.135 + 0.025, 0.080, 0.092, 0.005, 3), 0.0, FOOT, "rubber")
        _prism(mb, _circle(sx * 0.130, -0.090, 0.006, 10), 0.0, FOOT, "rubber")
    # vertiefte Tastaturwanne + Tasten
    _prism(mb, _rr(-0.1365, 0.1365, -0.0150, 0.1000, 0.003, 3), NB_H - 0.0004, NB_H + 0.0001, "plastic_black")
    top = _keyboard(mb, -0.0130)
    # Power-Taste mit Fingerabdruck-Sensor (Glas) rechts oben neben der Funktionsreihe
    mb.box(0.1335, 0.1362, top - 0.0100, top - 0.0005, NB_H + 0.0001, NB_H + 0.0012, "keycap")
    mb.box(0.1339, 0.1358, top - 0.0094, top - 0.0011, NB_H + 0.0012, NB_H + 0.00125, "touch_glass")
    # Glas-Touchpad mit Diamantschliff-Kante, Griffmulde vorne
    _prism(mb, _rr(-0.0605, 0.0605, -0.1045, -0.0295, 0.0045, 4), NB_H, NB_H + 0.00015, "device_silver")
    _prism(mb, _rr(-0.0600, 0.0600, -0.1040, -0.0300, 0.0040, 4), NB_H, NB_H + 0.0003, "touch_glass")
    mb.box(-0.0250, 0.0250, y0 - 0.0002, y0 + 0.0005, NB_H - 0.0040, NB_H - 0.0010, "plastic_black")
    # Scharnier: Walze ueber fast die ganze Breite, Endkappen in Alu
    _prism(mb, _circle(y1 - 0.0045, NB_H - 0.0002, 0.0040, 12), -0.125, 0.125, "plastic_black", axis="x")
    for sx in (-1, 1):
        _prism(mb, _circle(y1 - 0.0045, NB_H - 0.0002, 0.0041, 12), sx * 0.125, sx * 0.131, "laptop_alu", axis="x")
    # Lautsprechergitter links/rechts der Tastatur: Lochraster 3 x 16
    for sx in (-1, 1):
        for i in range(3):
            for j in range(16):
                hx = sx * 0.1500 + (i - 1) * 0.0030
                hy = -0.0080 + j * 0.0062
                _up(mb, hx - 0.0006, hx + 0.0006, hy - 0.0006, hy + 0.0006, NB_H + 0.00005, "hole_black")

    # Seitenanschluesse links (-X): RJ45 (Spiel-Port 01), USB-A (Konsole), USB-C, HDMI, Ladebuchse
    xo = x0 - 0.0006
    mb.box(xo, x0, -0.0400, -0.0240, 0.0030, 0.0145, "port_black")                 # RJ45-Rahmen
    _side(mb, xo - 0.00005, -0.0385, -0.0255, 0.0045, 0.0125, -1, "hole_black")     # Oeffnung
    _side(mb, xo - 0.0001, -0.0375, -0.0265, 0.0110, 0.0118, -1, "contact_gold")    # 8 Kontakte
    _side(mb, xo - 0.0001, -0.0335, -0.0305, 0.0045, 0.0060, -1, "port_black")      # Rastnase
    mb.box(xo, x0, 0.0000, 0.0090, 0.0060, 0.0105, "port_black")                   # USB-A (Konsole)
    mb.box(xo - 0.0001, x0, 0.0010, 0.0080, 0.0085, 0.0095, "port_vga")            # blaue USB-3-Zunge
    _prism(mb, _rr(0.0200, 0.0290, 0.0070, 0.0100, 0.0013, 2), xo, x0, "port_black", axis="x")  # USB-C
    _side(mb, xo - 0.00005, 0.0215, 0.0275, 0.0082, 0.0088, -1, "contact_gold")
    mb.box(xo, x0, 0.0400, 0.0550, 0.0050, 0.0110, "port_black")                   # HDMI
    _side(mb, xo - 0.00005, 0.0412, 0.0538, 0.0072, 0.0090, -1, "hole_black")
    _prism(mb, _rr(0.0700, 0.0790, 0.0070, 0.0100, 0.0013, 2), xo, x0, "port_black", axis="x")  # USB-C Laden
    mb.box(xo - 0.0001, x0, 0.0810, 0.0830, 0.0080, 0.0090, "led_off")             # Lade-LED
    # rechts (+X): USB-A, Klinke, SD-Kartenleser, Kensington-Schlitz
    xr = x1 + 0.0006
    mb.box(x1, xr, 0.0000, 0.0090, 0.0060, 0.0105, "port_black")
    mb.box(x1, xr + 0.0001, 0.0010, 0.0080, 0.0085, 0.0095, "port_vga")
    _prism(mb, _circle(-0.0270, 0.0088, 0.0018, 10), x1, xr, "port_black", axis="x")   # Klinke
    _prism(mb, _circle(-0.0270, 0.0088, 0.0011, 10), xr, xr + 0.00005, "hole_black", axis="x")
    mb.box(x1, xr, 0.0300, 0.0540, 0.0060, 0.0080, "port_black")                   # SD
    mb.box(x1, xr, 0.0900, 0.0970, 0.0055, 0.0090, "port_black")                   # Kensington
    _side(mb, xr + 0.00005, 0.0920, 0.0950, 0.0062, 0.0083, 1, "hole_black")
    # Lueftungsschlitze hinten
    for k in range(12):
        vx = -0.1000 + k * 0.0180
        mb.box(vx, vx + 0.0110, y1, y1 + 0.0004, 0.0040, 0.0080, "port_black")
    nb = mb.finish("device", collection=collection)
    nb["leyonet_type"] = "notebook"
    _bevel(nb, 0.0005, 2)
    # Status-LED vorne rechts auf der Handballenauflage (an = eingeschaltet)
    _top_quad(f"{name}_led_pwr", nb, 0.1400, 0.1440, -0.1060, -0.1040, NB_H + 0.0003, "led_green",
              {"leyonet_overlay": "led", "leyonet_led_state": "off"})

    lid = MeshBuilder(f"{name}_lid")
    _prism(lid, _rr(x0, x1, 0.0, LID_D, 0.007, 4), 0.0, LID_T, "laptop_alu", axis="y")   # Deckel, aufrecht
    _prism(lid, _rr(x0 + 0.0025, x1 - 0.0025, 0.0035, LID_D - 0.0025, 0.0050, 4), -0.0004, 0.0,
           "display_glass", axis="y")                                                    # Glasrahmen
    # Gummidichtung oben und seitlich am Glasrand (schuetzt die Tastatur beim Zuklappen)
    for (a, b, c, d) in ((x0 + 0.008, x1 - 0.008, LID_D - 0.0040, LID_D - 0.0030),
                         (x0 + 0.0030, x0 + 0.0040, 0.012, LID_D - 0.010),
                         (x1 - 0.0040, x1 - 0.0030, 0.012, LID_D - 0.010)):
        lid.box(a, b, -0.0006, -0.0004, c, d, "rubber")
    # Webcam: Linsenring, Linse, IR-Sensor, Kamera-LED
    zc = LID_D - 0.0070
    lid.cyl_y(0.0, zc, 0.0019, -0.0006, 0.0002, "plastic_black", seg=16)
    lid.cyl_y(0.0, zc, 0.0010, -0.0007, 0.0001, "hole_black", seg=12)
    lid.cyl_y(-0.0090, zc, 0.0008, -0.0006, 0.0002, "plastic_black", seg=10)
    lid.box(0.0060, 0.0070, -0.0006, -0.0004, zc - 0.0005, zc + 0.0005, "led_off")
    # Marke im Kinn (heller Schriftzug) + rundes Logo hinten
    lid.box(-0.0130, 0.0130, -0.0005, -0.0004, 0.0085, 0.0105, "key_legend")
    lid.cyl_y(0.0, LID_D / 2, 0.0160, LID_T, 0.0003, "device_silver", seg=28, cap="back")
    lid_obj = lid.finish("device_part", collection=collection)
    _bevel(lid_obj, 0.0005, 2)
    lid_obj.parent = nb
    # Scharnier hinten oben; Deckel um X gekippt: 110 deg offen = 20 deg nach hinten geneigt
    lid_obj.matrix_parent_inverse = Matrix.Identity(4)
    lid_obj.location = (0.0, y1 - LID_T, NB_H)
    lid_obj.rotation_euler = (-(LID_ANGLE - math.pi / 2), 0.0, 0.0)   # -20 deg = nach hinten geneigt

    # Bildschirm-Quad auf der Innenseite des Deckels (Richtung Nutzer = -Y im Deckel-Lokalraum),
    # Seitenverhaeltnis wie die Spiel-Canvas (512 x 310)
    sw, sh, sb = 0.306, 0.184, 0.019
    me = bpy.data.meshes.new(f"{name}_screen")
    bm = bmesh.new()
    y = -0.0008   # vor dem Display-Rahmen (-0.0004)
    vs = [bm.verts.new(p) for p in ((-sw / 2, y, sb), (sw / 2, y, sb), (sw / 2, y, sb + sh), (-sw / 2, y, sb + sh))]
    f = bm.faces.new(vs)
    f.normal_update()
    if f.normal.y > 0:
        f.normal_flip()
    uvl = bm.loops.layers.uv.new("UVMap")
    for loop, v in zip(f.loops, f.verts):
        loop[uvl].uv = ((v.co.x + sw / 2) / sw, (v.co.z - sb) / sh)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(materials.get("screen_dark"))
    scr = bpy.data.objects.new(f"{name}_screen", me)
    lid_obj.users_collection[0].objects.link(scr)
    scr.parent = lid_obj
    scr["leyonet_overlay"] = "screen"

    # Port-Hotspots (links, Normale -X) - wie die Retrofit-Overlays der Rack-Geraete
    _side_quad(f"{name}_port_01", nb, x0 - 0.0009, -0.0395, -0.0245, 0.0035, 0.014, -1, "port_black",
               {"leyonet_overlay": "port", "leyonet_port": "01", "leyonet_port_kind": "rj45"})
    _side_quad(f"{name}_port_con", nb, x0 - 0.0009, 0.0005, 0.0085, 0.0065, 0.010, -1, "port_black",
               {"leyonet_overlay": "port", "leyonet_port": "con", "leyonet_port_kind": "console"})
    return nb


def place_on_desk(nb, desk, x, y, yaw):
    """Notebook auf die Tischplatte stellen (Weltkoordinaten der Platte)."""
    nb.location = (x, y, desk["leyonet_desk_top"])
    nb.rotation_euler = (0.0, 0.0, yaw)
    return nb


def _obox(mb, cx, cy, ang, l0, l1, w, z0, z1, mat):
    """Box entlang der Richtung `ang` (rad, um Z) von l0 bis l1 ab (cx, cy), Breite w (Stuhlbeine)."""
    ca, sa = math.cos(ang), math.sin(ang)
    pts2 = [(l0, -w / 2), (l1, -w / 2), (l1, w / 2), (l0, w / 2)]
    ring = [(cx + a * ca - b * sa, cy + a * sa + b * ca) for a, b in pts2]
    _prism(mb, ring, z0, z1, mat)


SEAT_H = 0.47          # Sitzhoehe (Oberkante Polster)


def build_chair(name="chair_1", collection=None):
    """Buerostuhl (Plan v3): Fuenfstern-Fuss mit Rollen, Gasfeder, Mechanik, Polstersitz, Rueckenlehne
    mit Lordosen-Bogen, Armlehnen. Lokal: Mitte Sitz in x/y, z = 0 Boden, Nutzer blickt nach +Y
    (Lehne bei -Y). Kind-Empty `<name>_sit`: Sitzpunkt (leyonet_sit) fuers Spiel.
    Bevel 2 mm / 3 Seg. (Moebel wie der Tisch)."""
    base = MeshBuilder(f"{name}_base")
    for k in range(5):                                             # Fuenfstern + Rollen
        a = math.pi / 2 + k * 2 * math.pi / 5
        _obox(base, 0.0, 0.0, a, 0.02, 0.31, 0.034, 0.055, 0.080, "plastic_black")
        ex, ey = 0.30 * math.cos(a), 0.30 * math.sin(a)
        _prism(base, _circle(ey, 0.026, 0.024, 12), ex - 0.012, ex + 0.012, "plastic_black", axis="x")
        _prism(base, _circle(ex, ey, 0.010, 8), 0.040, 0.060, "steel_zinc")       # Rollen-Gabel
    _prism(base, _circle(0.0, 0.0, 0.040, 16), 0.050, 0.090, "plastic_black")     # Nabe
    _prism(base, _circle(0.0, 0.0, 0.026, 16), 0.090, 0.300, "plastic_black")     # Standrohr
    _prism(base, _circle(0.0, 0.0, 0.016, 16), 0.300, 0.395, "steel_zinc")        # Gasfeder (Chrom)
    base.box(-0.090, 0.090, -0.110, 0.110, 0.395, 0.425, "painted_steel")           # Mechanik
    base.box(0.090, 0.200, -0.012, 0.012, 0.400, 0.412, "plastic_black")            # Hebel
    _prism(base, _circle(0.205, 0.0, 0.012, 10), 0.394, 0.418, "plastic_black")
    # Armlehnen: Stuetze + Auflage
    for sx in (-1, 1):
        base.box(sx * 0.240 - 0.012, sx * 0.240 + 0.012, -0.100, -0.060, 0.410, 0.640, "plastic_black")
        base.box(sx * 0.215, sx * 0.255, -0.110, -0.040, 0.405, 0.420, "painted_steel")
        _prism(base, _rr(sx * 0.240 - 0.035, sx * 0.240 + 0.035, -0.150, 0.110, 0.025, 4),
               0.640, 0.665, "plastic_black")
    # Lehnentraeger hinten (Stahlbuegel)
    base.box(-0.030, 0.030, -0.250, -0.110, 0.405, 0.425, "painted_steel")
    base.box(-0.030, 0.030, -0.270, -0.245, 0.405, 0.700, "painted_steel")
    base_obj = base.finish("furniture", collection=collection)

    seat = MeshBuilder(f"{name}_seat")
    _prism(seat, _rr(-0.235, 0.235, -0.215, 0.235, 0.060, 5), 0.425, 0.440, "plastic_black")   # Sitzschale
    _prism(seat, _rr(-0.240, 0.240, -0.220, 0.240, 0.070, 5), 0.440, SEAT_H, "chair_fabric")   # Polster
    seat_obj = seat.finish("furniture", collection=collection)

    back = MeshBuilder(f"{name}_back")
    _prism(back, _rr(-0.215, 0.215, 0.0, 0.520, 0.080, 5), -0.020, 0.0, "plastic_black", axis="y")    # Schale
    _prism(back, _rr(-0.205, 0.205, 0.010, 0.510, 0.075, 5), 0.0, 0.045, "chair_fabric", axis="y")    # Polster
    back.box(-0.170, 0.170, 0.045, 0.060, 0.130, 0.220, "chair_fabric")                                # Lordose
    back_obj = back.finish("furniture", collection=collection)
    # Lehne leicht nach hinten geneigt (100 deg zur Sitzflaeche)
    back_obj.location = (0.0, -0.265, 0.520)
    back_obj.rotation_euler = (math.radians(-8), 0.0, 0.0)

    for o in (base_obj, seat_obj, back_obj):
        _bevel(o, 0.002, 3)
    for o in (seat_obj, back_obj):
        o.parent = base_obj
    sit = bpy.data.objects.new(f"{name}_sit", None)
    base_obj.users_collection[0].objects.link(sit)
    sit.parent = base_obj
    sit.location = (0.0, 0.0, SEAT_H)
    sit["leyonet_sit"] = 1
    base_obj["leyonet_chair"] = 1
    return base_obj
