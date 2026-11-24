"""Raum v3 (Plan v3, User-Entscheid 2026-11-20): Serverraum 8 x 6 m, 3 m lichte Hoehe, leer -
Racks, Geraete und Notebooks kauft und platziert das Spiel.

Grundriss (Raum-Koordinaten, Meter; x = Laenge 0..8, y = Tiefe 0..6, z = oben):

    y=6  +==================== Glasfront (Pfosten-Riegel) =========================+   draussen:
         |  Warmgang (1.8 m)                              [Tisch + 3 NB-Plaetze]   |   Pflaster,
    y=4.2|      [B1][B2][B3][B4]   Reihe B, Front -> -y      (Stuhl davor)          |   heller
         |      ---- Kaltgang 1.2 m (Lochplatten) ----                              |   Himmel
    y=2.0|      [A1][A2][A3][A4]   Reihe A, Front -> +y                             |
         |  Warmgang (1.0 m)                                                        |
    y=0  +--------------------------------------------------------[Tuer]-----------+
         x=0   1.6 ............ 4.0                                     6.2..7.2   x=8

- Slots: Empty `slot_rack_<n>` (n 1..8: A1..A4 = 1..4, B1..B4 = 5..8) am Rack-Ursprung
  (Boden, Mitte Frontrahmen; Rack-Lokal +y = in den Schrank), extras leyonet_slot = "rack",
  leyonet_slot_index, leyonet_row ("A"/"B"). Gelbe Bodenmarkierung um jeden Platz, Kabel-
  durchfuehrung mit Buerste hinten im Platz (Link nach unten, Doppelboden).
- `slot_nb_<n>` (1..3) auf der Tischplatte (leyonet_slot = "notebook"), Stuhl `chair_1` davor. Plan v4 D: grosses Pult
  2.8 x 0.9 m mit festen Plaetzen `slot_fix_*` (19-Zoll-Gestell, Tischdose, Steckdosenleiste), Energiesaeule zur Rinne.
- Glasfront: Alu-Pfosten alle 1.0 m, Riegel bei 2.40 m, Sockelprofil; Scheiben = room_glass.
- Draussen: Pflaster-Terrasse 14 m tief + emissiver Himmel (sky_bright) als Hintergrund.
Alle Raumteile Bevel 2 mm / 3 Seg. (Realismus-Regel 1); Materialien ambientCG (lib.textures).
"""
import math

import bpy

from . import furniture, props, room, uvtools
from .devices import MeshBuilder

W, D, H = 8.0, 6.0, 3.0
DOOR = (6.20, 7.20, 2.10)
RACK_X0 = 1.60                      # linke Kante der ersten Rack-Position
RACK_W, RACK_D = 0.60, 1.00
ROW_A_FRONT, ROW_B_FRONT = 2.00, 3.20     # Frontlinien (Kaltgang dazwischen)
N_PER_ROW = 4
# Plan v4 D: grosses Pult (Laenge entlang x, Nutzer bei -y), 0.7 m Durchgang zur Glasfront (Geraete-Rueckseiten)
DESK = dict(x=6.15, y=4.85, length=2.80, depth=0.90)
NB_X = (5.50, 6.00, 6.50)
CHAIR = (6.00, 4.05)
BENCH = (7.12, 4.45)                # 19-Zoll-Tischgestell rechts auf dem Pult (Mitte x, Vorderkante y)
DESK_OUTLET = (5.20, 5.12)          # Tischdose, Steckdosenleiste (Mitte x, Vorderseite y) an der Hinterkante
DESK_STRIP = (6.22, 5.12)
POLE = (4.90, 5.24)                 # Energiesaeule: Tischdose -> Gitterrinne
LED_X = (0.9, 2.2, 3.4, 4.8, 6.4, 7.5)
MULLION = 1.0                       # Pfostenraster der Glasfront
TRANSOM_Z = 2.40

VIEWS = {
    "view_door":  ((7.40, 0.40, 1.65), (3.00, 3.20, 1.00), 16),
    "view_aisle": ((4.90, 2.60, 1.60), (1.20, 2.60, 0.90), 18),
    "view_desk":  ((6.10, 2.70, 1.60), (6.10, 6.00, 0.95), 20),
    "view_bench": ((6.30, 3.70, 1.50), (7.10, 5.00, 0.80), 28),
    "view_wall":  ((4.60, 2.20, 1.60), (8.00, 2.60, 1.40), 20),
    "view_glass": ((0.60, 0.60, 1.70), (6.50, 5.80, 1.20), 16),
}


def rack_slots():
    """[(index, row, x_center, y_front, yaw)] - yaw dreht das Rack so, dass seine Front (lokal -y)
    in den Kaltgang zeigt: Reihe A Front +y -> yaw pi, Reihe B Front -y -> yaw 0."""
    out = []
    for k in range(N_PER_ROW):
        cx = RACK_X0 + RACK_W / 2 + k * RACK_W
        out.append((k + 1, "A", cx, ROW_A_FRONT, math.pi))
        out.append((N_PER_ROW + k + 1, "B", cx, ROW_B_FRONT, 0.0))
    return sorted(out)


def build_shell():
    """Decke + 3 Betonwaende (vorne mit Tuer). Die Rueckseite (y = D) ist die Glasfront."""
    shell = room.build_room_shell(w=W, d=D, h=H, door=DOOR)
    bpy.data.objects.remove(shell.pop("wall_back"))
    return shell


def build_glass_front():
    """Pfosten-Riegel-Fassade bei y = D: Sockel, Pfosten, Riegel, Kopfprofil; Scheiben separat.
    Returns (frame_obj, glass_obj)."""
    fr = MeshBuilder("glass_front_frame")
    gl = MeshBuilder("glass_front")
    p, dpt = 0.06, 0.12                      # Profilbreite / -tiefe
    y0, y1 = D, D + dpt
    fr.box(0.0, W, y0, y1, -0.32, 0.08, "window_alu")              # Sockelprofil (bis Rohboden)
    fr.box(0.0, W, y0, y1, H - 0.08, H, "window_alu")              # Kopfprofil
    xs = [k * MULLION for k in range(int(round(W / MULLION)) + 1)]
    for x in xs:
        a = min(max(x - p / 2, 0.0), W - p)
        fr.box(a, a + p, y0, y1, 0.08, H - 0.08, "window_alu")       # Pfosten
    for xa, xb in zip(xs[:-1], xs[1:]):
        fr.box(xa + p / 2, xb - p / 2, y0, y1, TRANSOM_Z - p / 2, TRANSOM_Z + p / 2, "window_alu")  # Riegel
        for za, zb in ((0.08, TRANSOM_Z - p / 2), (TRANSOM_Z + p / 2, H - 0.08)):
            gl.box(xa + p / 2, xb - p / 2, y0 + 0.055, y0 + 0.065, za, zb, "glass_front")
    return fr.finish("room"), gl.finish("room_glass")


def build_outside():
    """Terrasse (Pflaster) + heller Himmel. Returns (paving_obj, sky_obj)."""
    mb = MeshBuilder("outside_paving")
    mb.box(-6.0, W + 6.0, D + 0.12, D + 14.0, -0.05, 0.0, "outside_paving", skip=("-z", "-x", "+x", "-y", "+y"))
    paving = mb.finish("room")
    uvtools.box_project(paving, 1.0)
    sk = MeshBuilder("outside_sky")
    sk.box(-40.0, W + 40.0, D + 14.0, D + 14.2, -1.0, 24.0, "sky_bright", skip=("+y", "-x", "+x", "-z", "+z"))
    sky = sk.finish("room_sky")
    return paving, sky


def build_markings():
    """Gelbe Bodenmarkierung um jeden Rack-Platz + Kabeldurchfuehrung (Buerste) hinten im Platz.
    Returns (marking_obj, grommet_obj)."""
    mk = MeshBuilder("slot_markings")
    gr = MeshBuilder("slot_grommets")
    t, z = 0.03, 0.0006
    for idx, row, cx, yf, yaw in rack_slots():
        x0, x1 = cx - RACK_W / 2 + 0.005, cx + RACK_W / 2 - 0.005
        ya, yb = (yf - RACK_D, yf) if row == "A" else (yf, yf + RACK_D)
        for b in ((x0, x1, ya, ya + t), (x0, x1, yb - t, yb), (x0, x0 + t, ya, yb), (x1 - t, x1, ya, yb)):
            mk.box(b[0], b[1], b[2], b[3], 0.0, z, "floor_marking", skip=("-z",))
        # Durchfuehrung im hinteren Drittel (Warmgang-Seite), 250 x 120 mm
        gy = ya + 0.18 if row == "A" else yb - 0.30
        gr.box(cx - 0.125, cx + 0.125, gy, gy + 0.12, 0.0, z + 0.0004, "plastic_black", skip=("-z",))
        gr.box(cx - 0.110, cx + 0.110, gy + 0.015, gy + 0.105, z + 0.0004, z + 0.0008, "port_black", skip=("-z",))
    return mk.finish("room"), gr.finish("room")


TRAY_Z = 2.32                       # Unterkante Gitterrinne (Racks 2.0 m hoch)
TRAY_W, TRAY_H = 0.30, 0.06
POWER_OFF = 0.104                   # Strom-Spur neben der Rinnenmitte


def build_cable_trays():
    """Kabeltrassen (Ref-Vergleich 2026-11-20, ref_pdc_server_room): Gitterrinnen ueber beiden Rack-Reihen
    + Querverbindung ueber dem Kaltgang, an Gewindestangen von der Decke (alle 1.2 m). Drahtgitter als
    duenne Boxen (Quer- alle 10 cm, 4 Laengsdraehte). Kabel zeichnet das Spiel (placement.js): nur was wirklich in ein
    Rack fuehrt (Zuleitungen der PDUs, Trunks, Tischdose). Returns tray_obj."""
    mb = MeshBuilder("cable_trays")
    w, d, x0, x1 = 0.004, 0.004, RACK_X0 - 0.30, RACK_X0 + N_PER_ROW * RACK_W + 0.45
    rows = [(ROW_A_FRONT - RACK_D / 2), (ROW_B_FRONT + RACK_D / 2)]       # Mitte ueber den Racks

    def tray_x(yc, xa, xb):
        z0, z1 = TRAY_Z, TRAY_Z + TRAY_H
        for yy in (yc - TRAY_W / 2, yc - TRAY_W / 6, yc + TRAY_W / 6, yc + TRAY_W / 2):     # Laengsdraehte unten
            mb.box(xa, xb, yy - w / 2, yy + w / 2, z0, z0 + d, "steel_zinc")
        for yy in (yc - TRAY_W / 2, yc + TRAY_W / 2):                                     # Oberkante Seiten
            mb.box(xa, xb, yy - w / 2, yy + w / 2, z1 - d, z1, "steel_zinc")
        x = xa
        while x <= xb + 1e-6:                                                             # U-Buegel
            mb.box(x - w / 2, x + w / 2, yc - TRAY_W / 2, yc + TRAY_W / 2, z0, z0 + d, "steel_zinc")
            for yy in (yc - TRAY_W / 2, yc + TRAY_W / 2):
                mb.box(x - w / 2, x + w / 2, yy - w / 2, yy + w / 2, z0, z1, "steel_zinc")
            x += 0.10
        k = xa + 0.25
        while k < xb:                                                                     # Abhaengung
            for yy in (yc - TRAY_W / 2 - 0.02, yc + TRAY_W / 2 + 0.02):
                mb.box(k - 0.004, k + 0.004, yy - 0.004, yy + 0.004, z0 - 0.02, H, "steel_zinc")
            mb.box(k - 0.015, k + 0.015, yc - TRAY_W / 2 - 0.04, yc + TRAY_W / 2 + 0.04, z0 - 0.03, z0 - 0.0, "painted_steel")
            k += 1.2

    def tray_y(xc, ya, yb):
        z0, z1 = TRAY_Z, TRAY_Z + TRAY_H
        for xx in (xc - TRAY_W / 2, xc - TRAY_W / 6, xc + TRAY_W / 6, xc + TRAY_W / 2):
            mb.box(xx - w / 2, xx + w / 2, ya, yb, z0, z0 + d, "steel_zinc")
        for xx in (xc - TRAY_W / 2, xc + TRAY_W / 2):
            mb.box(xx - w / 2, xx + w / 2, ya, yb, z1 - d, z1, "steel_zinc")
        y = ya
        while y <= yb + 1e-6:
            mb.box(xc - TRAY_W / 2, xc + TRAY_W / 2, y - w / 2, y + w / 2, z0, z0 + d, "steel_zinc")
            for xx in (xc - TRAY_W / 2, xc + TRAY_W / 2):
                mb.box(xx - w / 2, xx + w / 2, y - w / 2, y + w / 2, z0, z1, "steel_zinc")
            y += 0.10
        ym = (ya + yb) / 2
        for xx in (xc - TRAY_W / 2 - 0.02, xc + TRAY_W / 2 + 0.02):
            mb.box(xx - 0.004, xx + 0.004, ym - 0.004, ym + 0.004, z0 - 0.02, H, "steel_zinc")

    for yc, xe in zip(rows, (x1, POLE[0] + TRAY_W / 2)):      # Reihe B verlaengert bis ueber das Pult (Tischdose)
        tray_x(yc, x0, xe)
    tray_y(POLE[0], rows[1] + TRAY_W / 2, POLE[1] - 0.04)
    xq = x1 - TRAY_W / 2                       # Querverbindung ueber dem Kaltgang (Rack-Reihenende)
    tray_y(xq, rows[0] + TRAY_W / 2, rows[1] - TRAY_W / 2)
    tray = mb.finish("room")
    uvtools.box_project(tray, 1.0)

    return tray


def power_taps():
    """Abgangskaesten an der Decke (Zuleitungen der Rack-PDUs): Reihe -> (x, z) in glTF. Auf der Seite der
    Dach-Einfuehrung der Racks, ueber der Strom-Spur der Gitterrinne (Reihenmitte +-10.5 cm)."""
    return {"A": (1.42, round(-(ROW_A_FRONT - RACK_D / 2) + POWER_OFF, 4)),
            "B": (1.42, round(-(ROW_B_FRONT + RACK_D / 2) - POWER_OFF, 4))}


def tray_manifest():
    """Gitterrinnen fuers Spiel (Trunk-Wege ueber Kopf), glTF-Koordinaten (x, z, -y)."""
    x1 = RACK_X0 + N_PER_ROW * RACK_W + 0.45
    return {"z": round(TRAY_Z + 0.030, 4), "rows": {"A": -(ROW_A_FRONT - RACK_D / 2), "B": -(ROW_B_FRONT + RACK_D / 2)},
            "cross_x": round(x1 - TRAY_W / 2, 4), "pole": [POLE[0], -POLE[1]],
            "power": {"z": round(H - props.POWER_BOX_H, 4), "taps": {r: list(t) for r, t in power_taps().items()}}}


def _slot_empty(name, loc, yaw, props):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.location = loc
    e.rotation_euler = (0.0, 0.0, yaw)
    e.empty_display_size = 0.2
    for k, v in props.items():
        e[k] = v
    return e


def build_room_v3():
    """Kompletter leerer Raum. Returns dict mit groups (Bake), unbaked, slots, parts."""
    shell = build_shell()
    tiles, perf, sub = room.build_raised_floor(
        w=W, d=D, origin=(RACK_X0, ROW_A_FRONT),
        perforated=((RACK_X0, RACK_X0 + N_PER_ROW * RACK_W), (ROW_A_FRONT, ROW_B_FRONT)),
        worn=((5.4, W), (0.0, 4.0)))
    door, door_glass = room.build_door(x0=DOOR[0], x1=DOOR[1], height=DOOR[2])
    leds = [room.build_led_band(f"led_band_{i + 1}", x, y0=0.5, y1=D - 0.5, z_ceiling=H) for i, x in enumerate(LED_X)]
    frame, glass = build_glass_front()
    paving, sky = build_outside()
    marks, grommets = build_markings()
    trays = build_cable_trays()
    power_boxes = [props.build_power_box((x, -z), H, name=f"power_box_{r.lower()}") for r, (x, z) in power_taps().items()]
    extinguisher = props.build_fire_extinguisher(loc=(W - 0.015, 1.10, 0.0))   # rechte Wand, beim Tisch-Bereich
    exit_sign = props.build_exit_sign(loc=((DOOR[0] + DOOR[1]) / 2, 0.0, DOOR[2] + 0.20))
    # Plan v4: Wandbildschirm (Netzplan) an der rechten Wand, Lichtschalter innen neben der Tuer
    display, screen = props.build_wall_display(loc=(W, 3.0, 1.60))
    switch = props.build_light_switch(loc=(DOOR[1] + 0.22, 0.0, 1.10))
    pole = props.build_service_pole(POLE, z0=furniture.DESK_H, z1=H)
    sprinklers = [props.build_sprinkler(x, 0.15, D - 0.15, z_ceiling=H, name=f"sprinkler_{i + 1}") for i, x in enumerate((2.80, 5.60))]
    desk = furniture.build_desk("desk_1", length=DESK["length"], depth=DESK["depth"])
    desk.location = (DESK["x"], DESK["y"], 0.0)
    desk.rotation_euler = (0.0, 0.0, math.pi / 2)      # Laenge entlang x
    chair = furniture.build_chair("chair_1")
    chair.location = (CHAIR[0], CHAIR[1], 0.0)          # Blick +y zum Tisch / zur Glasfront
    bpy.context.view_layer.update()

    uvtools.box_project(door, 1.0)
    for o in (*leds, frame):
        uvtools.box_project_aligned(o, 1.0)
    for o in (door_glass, glass, marks, grommets, exit_sign):
        uvtools.box_project(o, 1.0)
    parts = [*shell.values(), tiles, perf, sub, door, *leds, frame, marks, grommets, door_glass, glass, paving, trays,
             exit_sign]
    for o in parts:
        room.bevel(o)
    for o in (display, switch, pole, *power_boxes):                         # Detailteile: 0.5 mm / 2 Segmente
        room.bevel(o, width=0.0005, segments=2)

    slots = []
    for idx, row, cx, yf, yaw in rack_slots():
        slots.append(_slot_empty(f"slot_rack_{idx}", (cx, yf, 0.0), yaw,
                                 {"leyonet_slot": "rack", "leyonet_slot_index": idx, "leyonet_row": row}))
    top_z = desk["leyonet_desk_top"]
    for k, x in enumerate(NB_X):
        slots.append(_slot_empty(f"slot_nb_{k + 1}", (x, DESK["y"] - 0.18, top_z), 0.0,
                                 {"leyonet_slot": "notebook", "leyonet_slot_index": k + 1}))
    # Plan v4 D: feste Plaetze auf dem Pult - das Spiel stellt die Bausatz-Vorlage selbst hin (nicht ausbaubar)
    for name, tpl, (x, y) in (("slot_fix_bench", "kit_bench", BENCH), ("slot_fix_outlet", "kit_table_outlet", DESK_OUTLET),
                              ("slot_fix_strip", "kit_desk_strip", DESK_STRIP)):
        slots.append(_slot_empty(name, (x, y, top_z), 0.0, {"leyonet_slot": "fixed", "leyonet_slot_index": 1, "leyonet_vorlage": tpl}))
    furn = [o for root in (desk, chair) for o in room._descendants(root)]
    groups = {
        "room": [*shell.values(), tiles, perf, sub, door, *leds, frame, marks, grommets],
        "desk_1": [o for o in furn if o.type == "MESH"],
        "outside": [paving],
        "props": [trays, *power_boxes, extinguisher, exit_sign, display, switch, pole, *sprinklers],      # Ref-Vergleich: Trassen + Alltagsobjekte
    }
    unbaked = [door_glass, glass, sky, screen, *slots, *[o for o in furn if o.type == "EMPTY"]]
    return {"groups": groups, "unbaked": unbaked, "slots": slots, "parts": parts, "shell": shell,
            "desk": desk, "chair": chair, "sky": sky}
