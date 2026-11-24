"""19-inch data-centre devices and a 42U rack (EIA-310 dimensions).

Units: metres. Conventions for every rack-mount device (local space):
  x = 0        centre of the front panel
  y = 0        rear face of the mounting ears == front face of the rack rail
               (-Y points out of the rack front, +Y into the rack)
  z = 0        bottom edge of the device's lowest U slot
Each builder returns ONE low-poly mesh object (Devices-Retrofit, lib.retrofit):
the detailed geometry is baked into a per-type panel texture (front/rear), the
object carries a 0.5 mm bevel modifier and CHILD overlays the game addresses:
  <device>_led_p<nn> (port LED), <device>_led_<func> (system LEDs), emissive quads
  <device>_port_<nn> port hotspots (switch, patch panel), <device>_display (7-seg)
Tagged with custom props: leyonet_kind, leyonet_type, he, depth.

Use mount(rack, device, u) to place a device with its bottom in U slot `u`
(1 = lowest), and verify_mounts(rack) for a geometric fit check.
"""
import math
import random

import bmesh
import bpy
from mathutils import Vector

from . import materials, retrofit, uvtools

# --- EIA-310 / 19" constants -------------------------------------------------
U = 0.04445                    # 1 rack unit = 1.75"
PANEL_W = 0.4826               # 19" front panel width
HOLE_PITCH_X = 0.4651          # 18.31" between hole centres (left <-> right)
RAIL_OPENING = 0.450           # 17.72" clear opening between the rails
BODY_W_MAX = 0.4445            # 17.5"  max chassis width behind the rails
HOLE_OFFSETS = (0.00635, 0.022225, 0.0381)  # hole centres from U boundary
HOLE_SIZE = 0.0095             # square cage-nut hole 9.5 mm
PANEL_GAP = 0.0004             # panel height is n*U - 0.8 mm (1U = 43.66 mm)

EPS = 1e-6


def panel_z(he):
    """(z_bottom, z_top) of the front panel of an `he`-unit device."""
    return PANEL_GAP, he * U - PANEL_GAP


# --- mesh builder ------------------------------------------------------------
class MeshBuilder:
    """Accumulates axis-aligned boxes / cylinders into one bmesh."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []
        self.leds = []      # (id, x0, x1, z0, z1, y_face, facing, material, state)
        self.ports = []     # (id, kind, x0, x1, z0, z1, y_face, facing)
        self.display = []   # (x0, x1, z0, z1, y_face) emissive 7-seg quads, facing -Y
        self.hotspots = []  # (kind, x0, x1, z0, z1, y_face) Interaktionsflaechen (KVM)

    def led(self, lid, x0, x1, z0, z1, y_face, mat, facing=-1):
        """LED: NOT baked, becomes the overlay quad <device>_led_<lid> (state = material)."""
        state = {"led_off": "off", "led_amber": "act"}.get(mat, "on")
        self.leds.append((lid, x0, x1, z0, z1, y_face, facing, mat, state))

    def port(self, pid, kind, x0, x1, z0, z1, y_face, facing=-1, label=None):
        """Port hotspot quad <device>_port_<pid> over the opening (geometry is baked too).
        `label`: Beschriftung am Geraet (z.B. WAN), sonst die Nummer."""
        self.ports.append((pid, kind, x0, x1, z0, z1, y_face, facing, label))

    def hotspot(self, kind, x0, x1, z0, z1, y_face):
        """Interaktionsflaeche <device>_<kind> (z.B. kvm), Overlay leyonet_overlay=<kind>."""
        self.hotspots.append((kind, x0, x1, z0, z1, y_face))

    def disp(self, x0, x1, z0, z1, y_face):
        self.display.append((x0, x1, z0, z1, y_face))

    def _mi(self, mat_name):
        if mat_name not in self.mats:
            self.mats.append(mat_name)
        return self.mats.index(mat_name)

    def _face(self, pts, normal, mi):
        f = self.bm.faces.new([self.bm.verts.new(p) for p in pts])
        f.material_index = mi
        f.normal_update()
        if f.normal.dot(Vector(normal)) < 0:
            f.normal_flip()
        return f

    def box(self, x0, x1, y0, y1, z0, z1, mat, skip=()):
        """Axis-aligned box. `skip` names faces to omit: '-x','+x','-y','+y','-z','+z'."""
        x0, x1 = sorted((x0, x1))
        y0, y1 = sorted((y0, y1))
        z0, z1 = sorted((z0, z1))
        mi = self._mi(mat)
        faces = {
            "-x": ([(x0, y0, z0), (x0, y1, z0), (x0, y1, z1), (x0, y0, z1)], (-1, 0, 0)),
            "+x": ([(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], (1, 0, 0)),
            "-y": ([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], (0, -1, 0)),
            "+y": ([(x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)], (0, 1, 0)),
            "-z": ([(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0)], (0, 0, -1)),
            "+z": ([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], (0, 0, 1)),
        }
        for key, (pts, n) in faces.items():
            if key not in skip:
                self._face(pts, n, mi)

    def front(self, x0, x1, z0, z1, y_face, depth, mat):
        """Detail protruding `depth` out of a front face (-Y) located at y_face."""
        self.box(x0, x1, y_face - depth, y_face, z0, z1, mat, skip=("+y",))

    def rear(self, x0, x1, z0, z1, y_face, depth, mat):
        """Detail protruding `depth` out of a rear face (+Y) located at y_face."""
        self.box(x0, x1, y_face, y_face + depth, z0, z1, mat, skip=("-y",))

    def quad_front(self, x0, x1, z0, z1, y, mat):
        """Single quad facing -Y (decals: holes, LEDs on a flat face)."""
        self._face([(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)], (0, -1, 0), self._mi(mat))

    def cyl_y(self, cx, cz, r, y_front, depth, mat, seg=12, cap="front"):
        """Cylinder along +Y from y_front to y_front+depth. cap: 'front' (-Y) or 'back' (+Y)."""
        mi = self._mi(mat)
        ring0 = [self.bm.verts.new((cx + r * math.cos(a), y_front, cz + r * math.sin(a)))
                 for a in (2 * math.pi * i / seg for i in range(seg))]
        ring1 = [self.bm.verts.new((v.co.x, y_front + depth, v.co.z)) for v in ring0]
        cf = self.bm.faces.new(ring0 if cap == "front" else ring1)
        cf.material_index = mi
        cf.normal_update()
        if (cf.normal.y > 0) == (cap == "front"):
            cf.normal_flip()
        for i in range(seg):
            j = (i + 1) % seg
            f = self.bm.faces.new((ring0[i], ring0[j], ring1[j], ring1[i]))
            f.material_index = mi
            f.normal_update()
            mid = (ring0[i].co + ring0[j].co) / 2
            if f.normal.dot(Vector((mid.x - cx, 0, mid.z - cz))) < 0:
                f.normal_flip()

    def finish(self, kind, he=0, depth=0.0, collection=None):
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-7)
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(materials.get(m))
        obj = bpy.data.objects.new(self.name, me)
        (collection or bpy.context.scene.collection).objects.link(obj)
        # UV0 in metres (texture-set materials scale per material); the object is
        # still at the origin, so world == local and the UVs move with the part
        uvtools.box_project_aligned(obj, 1.0)
        obj["leyonet_kind"] = kind
        obj["he"] = he
        obj["depth"] = depth
        return obj


# --- shared device parts -----------------------------------------------------
def _ears(mb, he, inner_x, mat="device_dark", y0=-0.0025):
    """Mounting ears from |x|=inner_x out to the panel edge, plus one screw per U
    in the centre hole (x = +-HOLE_PITCH_X/2)."""
    z0, z1 = panel_z(he)
    for s in (-1, 1):
        mb.box(s * inner_x, s * PANEL_W / 2, y0, 0.0, z0, z1, mat)
        for k in range(he):
            mb.cyl_y(s * HOLE_PITCH_X / 2, k * U + HOLE_OFFSETS[1], 0.0055,
                     y0 - 0.0018, 0.0018, "screw", seg=10)


def _rj45(mb, cx, z0, y_face, leds=True, led_top=True, link=True, act=False, pid=None, label=None):
    """RJ45 jack: metal shield, black opening, latch notch (baked). One port LED
    <device>_led_<pid> (link/activity/off) and, with `pid`, the port hotspot."""
    w, h = 0.0135, 0.0125
    mb.front(cx - w / 2, cx + w / 2, z0, z0 + h, y_face, 0.0004, "steel_zinc")
    yf = y_face - 0.0004
    oz0 = z0 + (0.0012 if led_top else 0.0030)
    mb.front(cx - 0.0058, cx + 0.0058, oz0, oz0 + 0.0082, yf, 0.0002, "port_black")
    nz = oz0 + 0.0082 if led_top else oz0 - 0.0022
    mb.front(cx - 0.0022, cx + 0.0022, nz, nz + 0.0022, yf, 0.0002, "port_black")
    if pid is not None:
        mb.port(pid, "rj45", cx - 0.0058, cx + 0.0058, oz0, oz0 + 0.0082, yf - 0.0002, label=label)
    if leds and pid is not None:
        lz = z0 + h - 0.0026 if led_top else z0 + 0.0006
        mb.led(f"p{pid}" if pid.isdigit() else pid, cx - 0.0058, cx - 0.0036, lz, lz + 0.0018,
               yf - 0.0002, ("led_amber" if act else "led_green") if link else "led_off")


def _c13(mb, cx, cz, y_face, upright=False):
    """IEC C13 outlet: housing + opening + 3 contacts. upright=True turns the
    long axis vertical (1U PDU); default is long axis horizontal (0U strip)."""
    def r(dx, dz):                     # rotate local offsets for upright outlets
        return (dz, dx) if upright else (dx, dz)
    hw, hh = r(0.0150, 0.0105)
    mb.front(cx - hw, cx + hw, cz - hh, cz + hh, y_face, 0.0015, "plastic_black")
    ow, oh = r(0.0080, 0.0058)
    yf = y_face - 0.0015
    mb.front(cx - ow, cx + ow, cz - oh, cz + oh, yf, 0.0002, "port_black")
    for dx, dz in ((-0.0035, -0.0015), (0.0035, -0.0015), (0.0, 0.0030)):
        px, pz = r(dx, dz)
        cw, ch = r(0.0007, 0.0012)
        mb.front(cx + px - cw, cx + px + cw, cz + pz - ch, cz + pz + ch,
                 yf - 0.0002, 0.0001, "steel_zinc")


def _c19(mb, cx, cz, y_face):
    mb.front(cx - 0.0140, cx + 0.0140, cz - 0.0110, cz + 0.0110, y_face, 0.0015, "plastic_black")
    yf = y_face - 0.0015
    mb.front(cx - 0.0110, cx + 0.0110, cz - 0.0075, cz + 0.0075, yf, 0.0002, "port_black")
    for dx in (-0.0055, 0.0, 0.0055):
        mb.front(cx + dx - 0.0018, cx + dx + 0.0018, cz - 0.0008, cz + 0.0008,
                 yf - 0.0002, 0.0001, "steel_zinc")


_SEG = {  # 7-segment map: a b c d e f g
    "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc",
    "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abcdfg",
}


def _seven_seg(mb, text, x0, z0, y_face, h=0.010):
    """Emissive 7-segment readout; '.' adds a decimal point to the previous digit."""
    w, t = h * 0.55, h * 0.12
    x = x0
    for ch in text:
        if ch == ".":
            mb.disp(x - t * 1.6, x - t * 0.4, z0, z0 + t, y_face)
            continue
        segs = {
            "a": (x + t, x + w - t, z0 + h - t, z0 + h),
            "g": (x + t, x + w - t, z0 + h / 2 - t / 2, z0 + h / 2 + t / 2),
            "d": (x + t, x + w - t, z0, z0 + t),
            "f": (x, x + t, z0 + h / 2 + t / 2, z0 + h - t),
            "b": (x + w - t, x + w, z0 + h / 2 + t / 2, z0 + h - t),
            "e": (x, x + t, z0 + t, z0 + h / 2 - t / 2),
            "c": (x + w - t, x + w, z0 + t, z0 + h / 2 - t / 2),
        }
        for s in _SEG[ch]:
            a, b, c, d = segs[s]
            mb.disp(a, b, c, d, y_face)
        x += w + t * 2.5


# --- devices -----------------------------------------------------------------
def _low_ears(lb, he, inner_x, mat="device_dark", y0=-0.0025):
    z0, z1 = panel_z(he)
    for s in (-1, 1):
        lb.box(s * inner_x, s * PANEL_W / 2, y0, 0.0, z0, z1, mat)


def build_server_1u(name="server_1u", depth=0.70, seed=0, collection=None):
    """Generic 1U server: 8x 2.5" bays (4x2), control panel, vents, rear PSUs/NICs.
    LEDs: _led_pwr, _led_health, _led_fault, _led_bay01..08, _led_psu1/2, _led_nic1..4."""
    rnd = random.Random(seed)
    mb = MeshBuilder(f"server_1u__high")
    z0, z1 = panel_z(1)
    bw = 0.2175                       # 435 mm chassis
    yb = -0.025                       # bezel protrudes 25 mm in front of the rail

    mb.box(-bw, bw, 0.0, depth, z0, z1, "device_silver", skip=("-y",))   # chassis
    mb.box(-bw, bw, yb, 0.0, z0, z1, "device_dark", skip=("+y",))       # bezel
    _ears(mb, 1, bw)

    # control panel (left)
    mb.led("pwr", -0.2053, -0.1977, 0.0184, 0.0260, yb - 0.0012, "led_blue")
    mb.cyl_y(-0.1905, 0.0222, 0.0025, yb - 0.0010, 0.0010, "plastic_grey", seg=12)  # ID btn
    mb.led("health", -0.1830, -0.1800, 0.0290, 0.0320, yb - 0.0004, "led_green")
    mb.led("fault", -0.1830, -0.1800, 0.0230, 0.0260, yb - 0.0004,
           "led_amber" if rnd.random() < 0.15 else "led_off")
    mb.front(-0.1755, -0.1680, 0.0080, 0.0215, yb, 0.0003, "port_black")         # USB (vert.)

    # 8 drive bays, 4 columns x 2 rows
    bay = 0
    for col in range(4):
        bx0 = -0.1600 + col * 0.0760
        bx1 = bx0 + 0.0740
        for (bz0, bz1) in ((0.0030, 0.0212), (0.0232, 0.0414)):
            bay += 1
            mb.front(bx0, bx1, bz0, bz1, yb, 0.0015, "plastic_grey")
            yf = yb - 0.0015
            for k in range(3):   # vent slots
                sz = bz0 + 0.0035 + k * 0.0045
                mb.front(bx0 + 0.004, bx0 + 0.038, sz, sz + 0.0022, yf, 0.0002, "port_black")
            mb.front(bx0 + 0.043, bx1 - 0.011, bz0 + 0.004, bz1 - 0.004, yf, 0.0008, "device_silver")
            mb.led(f"bay{bay:02d}", bx1 - 0.0075, bx1 - 0.0040, bz1 - 0.0060, bz1 - 0.0035, yf - 0.0003,
                   "led_green" if rnd.random() < 0.8 else "led_off")
            rnd.random()             # keeps the seed sequence of v1 (drive-ID LED dropped)

    # right: vent, VGA, USB, pull-out label
    for k in range(6):
        sz = 0.0110 + k * 0.0048
        mb.front(0.1475, 0.1820, sz, sz + 0.0026, yb, 0.0002, "port_black")
    mb.front(0.1475, 0.1820, 0.0040, 0.0080, yb, 0.0004, "label_white")
    mb.front(0.1880, 0.2050, 0.0260, 0.0340, yb, 0.0005, "port_vga")
    mb.front(0.1900, 0.2030, 0.0110, 0.0165, yb, 0.0003, "port_black")

    # rear panel
    yr = depth
    for i, px in enumerate((-0.2150, -0.1720)):     # 2 hot-swap PSUs
        mb.rear(px, px + 0.0400, 0.0030, 0.0410, yr, 0.0020, "device_dark")
        mb.rear(px + 0.0050, px + 0.0230, 0.0140, 0.0300, yr + 0.0020, 0.0006, "port_black")  # C14
        mb.led(f"psu{i + 1}", px + 0.0300, px + 0.0340, 0.0300, 0.0330, yr + 0.0023, "led_green", facing=1)
        if i == 0:   # Plan v4: Strom per Kabel (PDU -> PSU1)
            mb.port("psu", "power", px + 0.0050, px + 0.0230, 0.0140, 0.0300, yr + 0.0026, facing=1, label="PSU")
        mb.rear(px + 0.0280, px + 0.0380, 0.0050, 0.0250, yr + 0.0020, 0.0040, "device_silver")  # handle
    for k in range(4):                # 4x RJ45 NIC (rear)
        cx = -0.0900 + k * 0.0150
        mb.rear(cx - 0.0065, cx + 0.0065, 0.0060, 0.0180, yr, 0.0004, "steel_zinc")
        mb.rear(cx - 0.0055, cx + 0.0055, 0.0075, 0.0155, yr + 0.0004, 0.0002, "port_black")
        mb.led(f"nic{k + 1}", cx - 0.0055, cx - 0.0035, 0.0160, 0.0175, yr + 0.0006, "led_green", facing=1)
    for k in range(2):                # 2x SFP+
        cx = -0.0150 + k * 0.0170
        mb.rear(cx - 0.0070, cx + 0.0070, 0.0060, 0.0160, yr, 0.0006, "steel_zinc")
        mb.rear(cx - 0.0060, cx + 0.0060, 0.0072, 0.0148, yr + 0.0006, 0.0002, "port_black")
    for k in range(7):                # exhaust vents
        sx = 0.0300 + k * 0.0260
        mb.rear(sx, sx + 0.0200, 0.0050, 0.0390, yr, 0.0002, "port_black")

    lb = MeshBuilder(name)
    lb.box(-bw, bw, 0.0, depth, z0, z1, "device_silver", skip=("-y",))
    lb.box(-bw, bw, yb, 0.0, z0, z1, "device_dark", skip=("+y",))
    _low_ears(lb, 1, bw)
    return retrofit.finish_device(f"server_1u_d{round(depth * 1000)}", mb, lb, "device", 1, depth,
                                  collection, rear_y=depth)


def build_switch_24(name="switch_24", depth=0.30, seed=0, collection=None, core=False):
    """1U access switch: 24x RJ45 (2x12, two blocks of 6 columns), 4x SFP+, console.
    core=True: Core-Switch (Layer 3, leyoNET 'l3switch') - blaues Typenschild, Typ coreswitch_24.
    Ports _port_01..24 (top row odd, bottom row even), _port_25..28 (SFP+), _port_con,
    _port_mgmt; LEDs _led_p01..p28, _led_mgmt, _led_pwr/_sys/_fan/_poe."""
    rnd = random.Random(seed)
    mb = MeshBuilder("switch_24__high")
    z0, z1 = panel_z(1)
    bw = 0.2195
    yf = -0.0025                      # front flush with the ears

    mb.box(-bw, bw, yf, depth, z0, z1, "device_dark")
    _ears(mb, 1, bw)

    # system LEDs + console (left)
    for k, (lid, lit) in enumerate((("pwr", "led_green"), ("sys", "led_green"),
                                     ("fan", "led_green"), ("poe", "led_off"))):
        lz = 0.0310 - k * 0.0062
        mb.led(lid, -0.2120, -0.2085, lz, lz + 0.0025, yf - 0.0003, lit)
    mb.front(-0.2040, -0.1880, 0.0040, 0.0165, yf, 0.0004, "port_vga")       # console (blue RJ45)
    mb.front(-0.2025, -0.1895, 0.0060, 0.0145, yf - 0.0004, 0.0002, "port_black")
    mb.port("con", "console", -0.2025, -0.1895, 0.0060, 0.0145, yf - 0.0006)
    mb.front(-0.2040, -0.1720, 0.0300, 0.0360, yf, 0.0002, "port_vga" if core else "label_white")  # logo plate

    # 24x RJ45
    pitch = 0.0145
    n = 0
    for blk in range(2):
        bx0 = -0.1600 + blk * (6 * pitch + 0.0080)
        for c in range(6):
            cx = bx0 + c * pitch + pitch / 2
            mb.front(cx - pitch / 2, cx + pitch / 2, 0.0035, 0.0405, yf, 0.0002, "plastic_black")
            yp = yf - 0.0002
            n += 1
            _rj45(mb, cx, 0.0215, yp, led_top=True, link=rnd.random() < 0.75,
                  act=rnd.random() < 0.35, pid=f"{2 * n - 1:02d}")
            _rj45(mb, cx, 0.0045, yp, led_top=False, link=rnd.random() < 0.75,
                  act=rnd.random() < 0.35, pid=f"{2 * n:02d}")

    # 4x SFP+ (2x2): ports 25..28
    k = 24
    for c in range(2):
        cx = 0.0450 + c * 0.0175
        for sz in (0.0230, 0.0050):
            k += 1
            mb.front(cx - 0.0075, cx + 0.0075, sz, sz + 0.0115, yf, 0.0006, "steel_zinc")
            mb.front(cx - 0.0062, cx + 0.0062, sz + 0.0020, sz + 0.0095, yf - 0.0006, 0.0002, "port_black")
            mb.port(f"{k:02d}", "sfp", cx - 0.0062, cx + 0.0062, sz + 0.0020, sz + 0.0095, yf - 0.0008)
            mb.led(f"p{k:02d}", cx - 0.0020, cx + 0.0020, sz + 0.0118, sz + 0.0135, yf - 0.0002,
                   "led_green" if c == 0 else "led_off")

    # mgmt port, mode button, vents
    _rj45(mb, 0.1000, 0.0140, yf, led_top=True, link=True, act=False, pid="mgmt")
    mb.cyl_y(0.1150, 0.0300, 0.0018, yf - 0.0006, 0.0006, "plastic_grey", seg=10)
    for k in range(5):
        sx = 0.1300 + k * 0.0160
        mb.front(sx, sx + 0.0100, 0.0060, 0.0380, yf, 0.0002, "port_black")

    # rear: C14 inlet, fans
    yr = depth
    mb.rear(-0.2000, -0.1700, 0.0080, 0.0360, yr, 0.0030, "plastic_black")
    mb.rear(-0.1950, -0.1750, 0.0140, 0.0300, yr + 0.0030, 0.0003, "port_black")
    mb.port("psu", "power", -0.1950, -0.1750, 0.0140, 0.0300, yr + 0.0033, facing=1, label="PSU")
    for fx in (0.0600, 0.1300):
        mb.cyl_y(fx, 0.0222, 0.0180, yr + 0.0002, 0.0002, "port_black", seg=20, cap="back")  # fan grille

    lb = MeshBuilder(name)
    lb.box(-bw, bw, yf, depth, z0, z1, "device_dark")
    _low_ears(lb, 1, bw)
    return retrofit.finish_device(f"{'coreswitch' if core else 'switch'}_24_d{round(depth * 1000)}", mb, lb, "device", 1, depth,
                                  collection, rear_y=depth)


def _appliance_1u(name, type_key, labels, accent, depth=0.30, collection=None):
    """1U-Netzwerkgeraet mit 4 RJ45 (Router/Firewall): System-LEDs, Konsole (CON), 4 Ports in einer
    Reihe mit Port-LED darueber, Typenschild, Lueftung; hinten Kaltgeraete-Buchse.
    Ports _port_01..04 (Beschriftung `labels`), _port_con; LEDs _led_p01..p04, _led_pwr, _led_sys."""
    mb = MeshBuilder(f"{type_key}__high")
    z0, z1 = panel_z(1)
    bw = 0.2195
    yf = -0.0025
    mb.box(-bw, bw, yf, depth, z0, z1, "device_dark")
    _ears(mb, 1, bw)
    for k, lid in enumerate(("pwr", "sys")):
        lz = 0.0290 - k * 0.0080
        mb.led(lid, -0.2120, -0.2085, lz, lz + 0.0025, yf - 0.0003, "led_green")
    mb.front(-0.2040, -0.1880, 0.0040, 0.0165, yf, 0.0004, "port_vga")            # Konsole (blau)
    mb.front(-0.2025, -0.1895, 0.0060, 0.0145, yf - 0.0004, 0.0002, "port_black")
    mb.port("con", "console", -0.2025, -0.1895, 0.0060, 0.0145, yf - 0.0006, label="CON")
    mb.front(-0.1800, -0.1100, 0.0280, 0.0380, yf, 0.0003, accent)                 # Typenschild
    pitch = 0.0200
    for k, lab in enumerate(labels):
        cx = -0.0700 + k * pitch
        _rj45(mb, cx, 0.0110, yf, led_top=True, link=False, pid=f"{k + 1:02d}", label=lab)
    for k in range(6):                                                              # Lueftung
        sx = 0.0700 + k * 0.0210
        mb.front(sx, sx + 0.0120, 0.0060, 0.0380, yf, 0.0002, "port_black")
    yr = depth
    mb.rear(-0.2000, -0.1700, 0.0080, 0.0360, yr, 0.0030, "plastic_black")
    mb.rear(-0.1950, -0.1750, 0.0140, 0.0300, yr + 0.0030, 0.0003, "port_black")
    mb.port("psu", "power", -0.1950, -0.1750, 0.0140, 0.0300, yr + 0.0033, facing=1, label="PSU")
    lb = MeshBuilder(name)
    lb.box(-bw, bw, yf, depth, z0, z1, "device_dark")
    _low_ears(lb, 1, bw)
    return retrofit.finish_device(type_key, mb, lb, "device", 1, depth, collection, rear_y=depth)


def build_kvm_1u(name="kvm_1u", depth=0.60, collection=None):
    """1U-KVM-Konsolschublade (zu): Griffe links/rechts, Typenschild, Power-LED, Griffmulde.
    Hotspot <device>_kvm (E im Spiel: Rack-Konsole / Konsolserver fuer die Geraete im Rack)."""
    mb = MeshBuilder("kvm_1u__high")
    z0, z1 = panel_z(1)
    bw = 0.2195
    yf = -0.0025
    mb.box(-bw, bw, yf, depth, z0, z1, "device_dark")
    _ears(mb, 1, bw)
    for s in (-1, 1):                                                           # Griffe
        mb.front(s * 0.2050 - 0.004, s * 0.2050 + 0.004, 0.0060, 0.0380, yf, 0.0070, "device_silver")  # < CAGE (8 mm)
    mb.front(-0.1700, -0.0900, 0.0260, 0.0360, yf, 0.0003, "label_white")       # Typenschild
    mb.front(-0.0600, 0.0600, 0.0080, 0.0160, yf, 0.0002, "port_black")         # Griffmulde
    mb.led("pwr", 0.1600, 0.1635, 0.0300, 0.0325, yf - 0.0003, "led_blue")
    mb.hotspot("kvm", -0.1950, 0.1950, z0 + 0.002, z1 - 0.002, yf - 0.0002)
    # Plan v4: hinten C14-Netzteilbuchse (Strom per Kabel von der PDU)
    mb.rear(-0.2000, -0.1700, 0.0080, 0.0360, depth, 0.0030, "plastic_black")
    mb.rear(-0.1950, -0.1750, 0.0140, 0.0300, depth + 0.0030, 0.0003, "port_black")
    mb.port("psu", "power", -0.1950, -0.1750, 0.0140, 0.0300, depth + 0.0033, facing=1, label="PSU")
    lb = MeshBuilder(name)
    lb.box(-bw, bw, yf, depth, z0, z1, "device_dark")
    _low_ears(lb, 1, bw)
    return retrofit.finish_device("kvm_1u", mb, lb, "device", 1, depth, collection, rear_y=depth)


def build_router_1u(name="router_1u", collection=None):
    """1U-Router, 4x RJ45 eth0..eth3 (leyoNET 'router'), Konsole."""
    return _appliance_1u(name, "router_1u", ("ETH0", "ETH1", "ETH2", "ETH3"), "label_white", collection=collection)


def build_firewall_1u(name="firewall_1u", collection=None):
    """1U-Firewall, 4x RJ45 WAN/LAN/DMZ/OPT1 (leyoNET 'firewall': default deny, Zonen), Konsole."""
    return _appliance_1u(name, "firewall_1u", ("WAN", "LAN", "DMZ", "OPT1"), "extinguisher_red", collection=collection)


def build_patchpanel_24(name="patchpanel_24", collection=None):
    """1U Cat6 patch panel: 24 keystone ports in 4 blocks of 6, label strips,
    keystone bodies and a rear cable-support bar. Ports _port_01..24 (left to right)."""
    mb = MeshBuilder("patchpanel_24__high")
    z0, z1 = panel_z(1)
    yf = -0.0020                      # 2 mm steel front plate incl. ears

    mb.box(-PANEL_W / 2, PANEL_W / 2, yf, 0.0, z0, z1, "rack_black")
    for s in (-1, 1):                 # screws (no separate ears, plate is full width)
        mb.cyl_y(s * HOLE_PITCH_X / 2, HOLE_OFFSETS[1], 0.0055, yf - 0.0018, 0.0018, "screw", seg=10)

    pitch, gap = 0.0165, 0.0080
    span = 4 * 6 * pitch + 3 * gap
    x_start = -span / 2
    port_x = []
    for blk in range(4):
        bx0 = x_start + blk * (6 * pitch + gap)
        mb.front(bx0, bx0 + 6 * pitch, 0.0325, 0.0395, yf, 0.0003, "label_white")
        for c in range(6):
            cx = bx0 + c * pitch + pitch / 2
            port_x.append(cx)
            mb.front(cx - 0.0074, cx + 0.0074, 0.0060, 0.0290, yf, 0.0015, "plastic_black")
            yk = yf - 0.0015
            mb.front(cx - 0.0058, cx + 0.0058, 0.0105, 0.0187, yk, 0.0002, "port_black")
            mb.front(cx - 0.0022, cx + 0.0022, 0.0187, 0.0209, yk, 0.0002, "port_black")
            mb.port(f"{len(port_x):02d}", "keystone", cx - 0.0058, cx + 0.0058, 0.0105, 0.0187, yk - 0.0002)
            # port number tick on the label strip
            mb.front(cx - 0.0010, cx + 0.0010, 0.0345, 0.0375, yf - 0.0003, 0.0001, "port_black")

    # rear: keystone bodies + cable support bar
    depth = 0.110
    for cx in port_x:
        mb.box(cx - 0.0074, cx + 0.0074, 0.0, 0.0350, 0.0060, 0.0290, "plastic_black", skip=("-y",))
    mb.box(-span / 2, span / 2, 0.1000, depth, 0.0040, 0.0100, "rack_black")
    for s in (-1, 1):
        mb.box(s * span / 2, s * (span / 2 + 0.004), 0.0, depth, 0.0040, 0.0350, "rack_black",
               skip=("-y",))

    # low: plate (front baked) + rear parts as simple boxes (keystone block, bar, brackets)
    lb = MeshBuilder(name)
    lb.box(-PANEL_W / 2, PANEL_W / 2, yf, 0.0, z0, z1, "rack_black")
    lb.box(-span / 2, span / 2, 0.0, 0.0350, 0.0060, 0.0290, "plastic_black", skip=("-y",))
    lb.box(-span / 2, span / 2, 0.1000, depth, 0.0040, 0.0100, "rack_black")
    for s in (-1, 1):
        lb.box(s * span / 2, s * (span / 2 + 0.004), 0.0, depth, 0.0040, 0.0350, "rack_black",
               skip=("-y",))
    return retrofit.finish_device("patchpanel_24", mb, lb, "device", 1, depth, collection, rear_y=None)


def build_pdu(name="pdu", style="1u", outlets=None, amps="3.2", collection=None):
    """Power distribution unit.

    style="1u": horizontal 1U rack PDU, 8x C13, illuminated switch, ammeter.
                Mount with mount(rack, pdu, u).
    style="0u": vertical zero-U PDU, 24x C13 + 6x C19, ammeter. Local z=0 is the
                bottom end, outlets face -Y. Mount with mount_pdu_0u(rack, pdu).
    LEDs _led_switch (1u), _led_ok; ammeter digits -> _display (per instance).
    """
    mb = MeshBuilder(f"pdu_{style}__high")
    if style == "1u":
        n = outlets or 8
        z0, z1 = panel_z(1)
        bw, yf, depth = 0.2195, -0.0025, 0.200
        mb.box(-bw, bw, yf, depth, z0, z1, "device_dark")
        _ears(mb, 1, bw)
        # illuminated rocker switch: housing baked, lit rocker = LED overlay
        mb.front(-0.2080, -0.1880, 0.0100, 0.0340, yf, 0.0015, "plastic_black")
        mb.led("switch", -0.2050, -0.1910, 0.0130, 0.0310, yf - 0.0035, "led_red")
        # ammeter
        mb.front(-0.1800, -0.1380, 0.0120, 0.0320, yf, 0.0004, "display_glass")
        _seven_seg(mb, amps, -0.1750, 0.0170, yf - 0.0004, h=0.0100)
        mb.led("ok", -0.1300, -0.1270, 0.0280, 0.0310, yf - 0.0003, "led_green")
        # outlets
        pitch = 0.0420
        x0 = -0.1000
        for i in range(n):
            _c13(mb, x0 + i * pitch, 0.0222, yf, upright=True)
            cx = x0 + i * pitch          # Plan v4 D: Buchsen steckbar (Shop: Stromleiste 1 HE)
            mb.port(f"{i + 1:02d}", "power", cx - 0.0058, cx + 0.0058, 0.0222 - 0.0080, 0.0222 + 0.0080, yf - 0.0017)
        # rear: C20 inlet
        mb.rear(-0.0150, 0.0150, 0.0080, 0.0360, depth, 0.0040, "plastic_black")
        mb.rear(-0.0110, 0.0110, 0.0140, 0.0300, depth + 0.0040, 0.0003, "port_black")
        lb = MeshBuilder(name)
        lb.box(-bw, bw, yf, depth, z0, z1, "device_dark")
        _low_ears(lb, 1, bw)
        return retrofit.finish_device(f"pdu_1u_o{n}", mb, lb, "device", 1, depth, collection,
                                      rear_y=depth, tex_long=retrofit.TEX_LONG_PLAIN)

    if style == "0u":
        length, hw, depth = 1.700, 0.0260, 0.0450
        mb.box(-hw, hw, 0.0, depth, 0.0, length, "device_dark")
        # top module: ammeter + breaker
        mb.front(-0.0200, 0.0200, length - 0.090, length - 0.060, 0.0, 0.0004, "display_glass")
        _seven_seg(mb, amps, -0.0150, length - 0.085, -0.0004, h=0.0150)
        mb.led("ok", -0.0040, 0.0040, length - 0.040, length - 0.032, -0.0003, "led_green")
        for k in range(2):  # breakers
            bz = length - 0.160 - k * 0.050
            mb.front(-0.0130, 0.0130, bz, bz + 0.035, 0.0, 0.0020, "plastic_black")
            mb.front(-0.0050, 0.0050, bz + 0.010, bz + 0.025, -0.0020, 0.0040, "label_white")
        # outlets: 3 groups of (8x C13, 2x C19), top to bottom
        z = length - 0.280
        outlet = 0
        for g in range(3):
            for i in range(8):
                _c13(mb, 0.0, z, 0.0)
                outlet += 1
                mb.port(f"{outlet:02d}", "power", -0.0080, 0.0080, z - 0.0058, z + 0.0058, -0.0017)
                z -= 0.0380
            for i in range(2):
                z -= 0.0050
                _c19(mb, 0.0, z, 0.0)
                z -= 0.0400
            z -= 0.0300
        mb.box(-0.0110, 0.0110, 0.0090, 0.0310, length, length + 0.025, "plastic_black")   # Verschraubung oben
        lb = MeshBuilder(name)
        lb.box(-hw, hw, 0.0, depth, 0.0, length, "device_dark")
        # Zuleitung von oben (Gitterrinne, 2026-11-23): nur die Verschraubung, das Kabel zeichnet das Spiel (placement.js)
        lb.box(-0.0110, 0.0110, 0.0090, 0.0310, length, length + 0.025, "plastic_black")
        return retrofit.finish_device("pdu_0u", mb, lb, "device_0u", 0, depth, collection,
                                      rear_y=None, transpose=True)

    raise ValueError(f"unknown PDU style {style!r}")


def build_desk_strip(name="desk_strip", collection=None):
    """Plan v4 D: Steckdosenleiste am Pult, 8x C13, beleuchteter Schalter, Aluprofil. Origin: Mitte, Boden,
    Vorderseite y = 0 (Dosen -y). Ports _port_01..08 (power), LEDs _led_switch, _led_ok."""
    n, pitch, hw, h, depth = 8, 0.0440, 0.2300, 0.0460, 0.0480
    mb = MeshBuilder("desk_strip__high")
    mb.box(-hw, hw, 0.0, depth, 0.0, h, "device_silver")
    for s in (-1, 1):                                                   # Endkappen
        mb.front(s * hw, s * (hw - 0.012), 0.0, h, 0.0, 0.0015, "plastic_black")
    mb.front(-0.2100, -0.1880, 0.0100, 0.0360, 0.0, 0.0015, "plastic_black")
    mb.led("switch", -0.2060, -0.1920, 0.0130, 0.0330, -0.0030, "led_red")
    mb.led("ok", -0.1820, -0.1790, 0.0330, 0.0360, -0.0003, "led_green")
    x0 = -0.1480
    for i in range(n):
        cx, cz = x0 + i * pitch, 0.0230
        _c13(mb, cx, cz, 0.0, upright=True)
        mb.port(f"{i + 1:02d}", "power", cx - 0.0058, cx + 0.0058, cz - 0.0080, cz + 0.0080, -0.0017)
    lb = MeshBuilder(name)
    lb.box(-hw, hw, 0.0, depth, 0.0, h, "device_silver")
    lb.box(hw, hw + 0.020, 0.018, 0.030, 0.017, 0.029, "rubber")         # Kabeltuelle
    return retrofit.finish_device("desk_strip_8", mb, lb, "device", 0, depth, collection, tex_long=retrofit.TEX_LONG_PLAIN)


def build_table_outlet(name="table_outlet", collection=None):
    """Plan v4 D: Tischdose am Pult, 8x RJ45-Keystone in einer Reihe mit Beschriftungsstreifen, Aluprofil.
    Origin: Mitte, Boden, Vorderseite y = 0 (Ports -y). Ports _port_01..08 (keystone)."""
    n, pitch, hw, h, depth = 8, 0.0330, 0.1500, 0.0520, 0.0550
    mb = MeshBuilder("table_outlet__high")
    mb.box(-hw, hw, 0.0, depth, 0.0, h, "device_silver")
    for s in (-1, 1):
        mb.front(s * hw, s * (hw - 0.010), 0.0, h, 0.0, 0.0015, "plastic_black")
    x0 = -(n - 1) * pitch / 2
    mb.front(x0 - 0.015, x0 + (n - 1) * pitch + 0.015, 0.0345, 0.0425, 0.0, 0.0003, "label_white")
    for i in range(n):
        cx = x0 + i * pitch
        mb.front(cx - 0.0090, cx + 0.0090, 0.0060, 0.0310, 0.0, 0.0015, "plastic_black")
        mb.front(cx - 0.0058, cx + 0.0058, 0.0120, 0.0202, -0.0015, 0.0002, "port_black")
        mb.front(cx - 0.0022, cx + 0.0022, 0.0202, 0.0224, -0.0015, 0.0002, "port_black")
        mb.port(f"{i + 1:02d}", "keystone", cx - 0.0058, cx + 0.0058, 0.0120, 0.0202, -0.0017)
    lb = MeshBuilder(name)
    lb.box(-hw, hw, 0.0, depth, 0.0, h, "device_silver")
    lb.box(-0.0060, 0.0060, depth, depth + 0.018, 0.020, 0.032, "rubber")
    return retrofit.finish_device("table_outlet_8", mb, lb, "device", 0, depth, collection, tex_long=retrofit.TEX_LONG_PLAIN)


def build_blank(he=1, name=None, collection=None):
    """Blanking panel (1-4U): closes unused slots so the cold aisle stays sealed."""
    mb = MeshBuilder(f"blank_{he}u__high")
    z0, z1 = panel_z(he)
    mb.box(-PANEL_W / 2, PANEL_W / 2, -0.0015, 0.0, z0, z1, "rack_black")
    for k in sorted({0, he - 1}):                 # screws in top and bottom U
        cz = k * U + HOLE_OFFSETS[1]
        for s in (-1, 1):
            mb.cyl_y(s * HOLE_PITCH_X / 2, cz, 0.0050, -0.0030, 0.0015, "plastic_black", seg=8)
    for k in range(he):                           # stiffening bead per U
        mb.front(-0.200, 0.200, k * U + 0.020, k * U + 0.0245, -0.0015, 0.0006, "rack_black")
    lb = MeshBuilder(name or f"blank_{he}u")
    lb.box(-PANEL_W / 2, PANEL_W / 2, -0.0015, 0.0, z0, z1, "rack_black")
    return retrofit.finish_device(f"blank_{he}u", mb, lb, "device", he, 0.0015, collection, rear_y=None,
                                  tex_long=retrofit.TEX_LONG_PLAIN)


def fill_blanks(rack, max_he=2):
    """Fill every free slot of `rack` with blanking panels (up to `max_he` U each)."""
    slots = list(rack["slots"])
    panels = []
    u = 1
    while u <= len(slots):
        if slots[u - 1]:
            u += 1
            continue
        he = 1
        while he < max_he and u + he <= len(slots) and not slots[u + he - 1]:
            he += 1
        p = build_blank(he, name=f"{rack.name}_blank_U{u}")
        mount(rack, p, u)
        panels.append(p)
        u += he
    return panels


# --- rack --------------------------------------------------------------------
def build_rack_42he(name="rack_42he", width=0.600, depth=1.000, height=2.000,
                    rail_setback=0.100, rail_depth=0.740, collection=None):
    """42U 19" rack: frame, side panels, top cover, plinth, 4 punched rails
    (EIA-310 square holes). Origin: floor, front face of the frame, centred in x.
    Rack props: z_u1 (bottom of U1), y_front_rail, y_rear_rail, slots (occupancy)."""
    mb = MeshBuilder(name)
    # Ref-Vergleich 2026-11-20: echte Racks sind matt schwarz pulverbeschichtet (RAL 9005), nicht blank
    RACK_SKIN = "rack_powder"
    hu = 42
    hw = width / 2
    post = 0.040
    plinth_h, bot_h, top_h = 0.050, 0.035, 0.040
    z_u1 = plinth_h + bot_h + 0.005
    z_rail_top = z_u1 + hu * U
    z_top = height
    assert z_rail_top <= z_top - top_h + EPS, "42U does not fit into the frame height"
    yfr = rail_setback
    yrr = rail_setback + rail_depth

    # plinth
    mb.box(-hw + 0.010, hw - 0.010, 0.010, depth - 0.010, 0.0, plinth_h, "rack_plinth")
    # corner posts
    for sx in (-1, 1):
        for (y0, y1) in ((0.0, post), (depth - post, depth)):
            mb.box(sx * hw, sx * (hw - post), y0, y1, plinth_h, z_top, RACK_SKIN)
    # bottom / top frames
    for (fz0, fz1) in ((plinth_h, plinth_h + bot_h), (z_top - top_h, z_top)):
        for (y0, y1) in ((0.0, post), (depth - post, depth)):
            mb.box(-hw + post, hw - post, y0, y1, fz0, fz1, RACK_SKIN, skip=("-x", "+x"))
        for sx in (-1, 1):
            mb.box(sx * hw, sx * (hw - post), post, depth - post, fz0, fz1, RACK_SKIN,
                   skip=("-y", "+y"))
    # top cover + side panels
    mb.box(-hw, hw, 0.0, depth, z_top, z_top + 0.0015, RACK_SKIN)
    # Kabeleinfuehrung im Dach (Buerstenleiste, Ref-Vergleich 2026-11-23): Trunks gehen von hier in die Gitterrinne
    mb.box(-0.170, 0.170, 0.700, 0.860, z_top + 0.0015, z_top + 0.0045, "plastic_black")
    mb.box(-0.155, 0.155, 0.715, 0.845, z_top + 0.0045, z_top + 0.0050, "rubber")
    for sx in (-1, 1):
        mb.box(sx * hw, sx * (hw + 0.0015), 0.0, depth, plinth_h, z_top, RACK_SKIN)
    # rail carriers (side members holding the rails), bottom and top
    for (cz0, cz1) in ((plinth_h + bot_h, plinth_h + bot_h + 0.020), (z_top - top_h - 0.020, z_top - top_h)):
        for sx in (-1, 1):
            mb.box(sx * 0.2495, sx * (hw - post), post, depth - post, cz0, cz1, RACK_SKIN)
    # rails: L-profile, flange faces the front for front and rear rails
    rz0, rz1 = plinth_h + bot_h, z_top - top_h
    flange_in = RAIL_OPENING / 2           # 225 mm
    for y in (yfr, yrr):
        for sx in (-1, 1):
            mb.box(sx * flange_in, sx * 0.2475, y, y + 0.002, rz0, rz1, "steel_zinc")
            mb.box(sx * 0.2475, sx * 0.2495, y, y + 0.040, rz0, rz1, "steel_zinc")
            # square holes, 3 per U
            hx = sx * HOLE_PITCH_X / 2
            for u in range(hu):
                for off in HOLE_OFFSETS:
                    hz = z_u1 + u * U + off
                    mb.quad_front(hx - HOLE_SIZE / 2, hx + HOLE_SIZE / 2,
                                  hz - HOLE_SIZE / 2, hz + HOLE_SIZE / 2, y - 0.0001, "hole_black")
            # U boundary marks on the front rails (small ticks next to the holes)
            if y == yfr:
                for u in range(hu + 1):
                    tz = z_u1 + u * U
                    mb.quad_front(sx * 0.2440, sx * 0.2470, tz - 0.0003, tz + 0.0003,
                                  y - 0.0001, "label_white")

    obj = mb.finish("rack", he=hu, depth=depth, collection=collection)
    obj["z_u1"] = z_u1
    obj["y_front_rail"] = yfr
    obj["y_rear_rail"] = yrr
    obj["width"] = width
    obj["height"] = z_top
    obj["slots"] = [0] * hu
    return obj


# --- mounting / verification -------------------------------------------------
def u_bottom(rack, u):
    """z (rack space) of the bottom boundary of U slot `u` (1-based)."""
    return rack["z_u1"] + (u - 1) * U


def mount(rack, device, u):
    """Mount `device` with its lowest unit in slot `u` (1 = bottom). Raises on
    overlap or overflow."""
    he = int(device["he"])
    hu = int(rack["he"])
    if he < 1:
        raise ValueError(f"{device.name} is not a rack-unit device (he={he})")
    if u < 1 or u + he - 1 > hu:
        raise ValueError(f"{device.name}: U{u}..U{u + he - 1} outside 1..{hu}")
    slots = list(rack["slots"])
    for k in range(u - 1, u - 1 + he):
        if slots[k]:
            raise ValueError(f"{device.name}: U{k + 1} already occupied")
        slots[k] = 1
    rack["slots"] = slots
    device.parent = rack
    device.matrix_parent_inverse.identity()
    device.location = (0.0, rack["y_front_rail"], u_bottom(rack, u))
    device.rotation_euler = (0.0, 0.0, 0.0)
    device["rack_u"] = u
    return device


def mount_pdu_0u(rack, pdu, side=1, z=0.150):
    """Mount a 0U PDU vertically in the rear of the rack, outlets facing the
    rear door. side=+1 right, -1 left (seen from the front)."""
    pdu.parent = rack
    pdu.matrix_parent_inverse.identity()
    pdu.location = (side * 0.2730, rack["y_rear_rail"] + 0.100, z)
    pdu.rotation_euler = (0.0, 0.0, math.pi)
    pdu["rack_0u_side"] = side
    return pdu


def verify_mounts(rack):
    """Geometric fit check of every device mounted with mount(). Returns a list of
    dicts (one per device) with 'ok' and 'issues'."""
    bpy.context.view_layer.update()   # matrix_local is stale right after mount()
    yfr, yrr = rack["y_front_rail"], rack["y_rear_rail"]
    rows = []
    for dev in sorted((c for c in rack.children if "rack_u" in c), key=lambda o: o["rack_u"]):
        u, he = int(dev["rack_u"]), int(dev["he"])
        sz0, sz1 = u_bottom(rack, u), u_bottom(rack, u + he)
        m = dev.matrix_local
        pts = [m @ v.co for v in dev.data.vertices]
        zmin = min(p.z for p in pts)
        zmax = max(p.z for p in pts)
        xmax = max(abs(p.x) for p in pts)
        behind = [p for p in pts if p.y > yfr + 1e-5]
        xmax_behind = max((abs(p.x) for p in behind), default=0.0)
        ymax = max((p.y for p in behind), default=yfr)
        issues = []
        if zmin < sz0 - EPS or zmax > sz1 + EPS:
            issues.append(f"z {zmin:.5f}..{zmax:.5f} outside slot {sz0:.5f}..{sz1:.5f}")
        if xmax > PANEL_W / 2 + EPS:
            issues.append(f"width {2 * xmax * 1000:.1f} mm > 482.6 mm")
        if xmax_behind >= RAIL_OPENING / 2:
            issues.append(f"body width {2 * xmax_behind * 1000:.1f} mm does not pass 450 mm rail opening")
        if ymax > yrr:
            issues.append(f"depth reaches y={ymax:.3f}, rear rail at {yrr:.3f}")
        rows.append({
            "device": dev.name, "u": f"U{u}" if he == 1 else f"U{u}-U{u + he - 1}",
            "slot_mm": (round(sz0 * 1000, 2), round(sz1 * 1000, 2)),
            "panel_mm": (round(zmin * 1000, 2), round(zmax * 1000, 2)),
            "body_w_mm": round(2 * xmax_behind * 1000, 1),
            "ok": not issues, "issues": issues,
        })
    return rows
