"""Principled-BSDF material presets for the leyonet DC assets.

Only Principled BSDF is used (glTF-compatible). Flat presets are left only for
emissives (LEDs, 7-seg, LED diffuser), parts under 1 cm (rail holes, contacts,
LED lenses) and the render-only floor; every other name resolves to an
ambientCG texture set in lib.textures.SETS (Realismus-Regel 2). LEDs/displays use the
Principled emission inputs, which export as KHR_materials_emissive_strength.
"""
import bpy

# name: (base_color, metallic, roughness, emission_color or None, emission_strength)
PRESETS = {
    "hole_black":     ((0.0, 0.0, 0.0), 0.0, 1.0, None, 0.0),
    "contact_gold":   ((0.95, 0.72, 0.35), 1.0, 0.25, None, 0.0),
    "led_off":        ((0.06, 0.07, 0.06), 0.0, 0.25, None, 0.0),
    "led_green":      ((0.10, 1.00, 0.20), 0.0, 0.30, (0.10, 1.00, 0.20), 3.0),
    "led_amber":      ((1.00, 0.55, 0.05), 0.0, 0.30, (1.00, 0.55, 0.05), 3.0),
    "led_blue":       ((0.10, 0.35, 1.00), 0.0, 0.30, (0.10, 0.35, 1.00), 3.0),
    "led_red":        ((1.00, 0.06, 0.04), 0.0, 0.30, (1.00, 0.06, 0.04), 3.0),
    "display_seg":    ((1.00, 0.10, 0.05), 0.0, 0.30, (1.00, 0.10, 0.05), 3.0),
    "key_legend":     ((0.42, 0.43, 0.45), 0.0, 0.55, None, 0.0),                   # Tasten-/Marken-Aufdruck (< 1 cm)
    "hotspot":        ((0.0, 0.0, 0.0), 0.0, 1.0, None, 0.0),                       # unsichtbare Klickflaeche (Spiel)
    "screen_dark":    ((0.02, 0.025, 0.03), 0.0, 0.15, (0.05, 0.07, 0.10), 1.0),   # Notebook-Display (Spiel zeichnet darauf)
    "sign_green":     ((0.00, 0.45, 0.20), 0.0, 0.40, (0.00, 0.60, 0.25), 6.0),     # backlit exit sign
    "sign_white":     ((0.90, 0.95, 0.92), 0.0, 0.40, (0.90, 1.00, 0.95), 6.0),
    "floor":          ((0.30, 0.30, 0.31), 0.0, 0.80, None, 0.0),
    "sky_bright":     ((0.85, 0.92, 1.00), 0.0, 1.00, (0.85, 0.92, 1.00), 4.0),     # Raum v3: Tageslicht draussen (Emissive)
    # room
    "paint_white":    ((0.72, 0.72, 0.70), 0.0, 0.85, None, 0.0),       # ceiling paint
    "alu":            ((0.80, 0.81, 0.83), 1.0, 0.35, None, 0.0),       # profiles
    "led_diffuser":   ((0.95, 0.95, 0.92), 0.0, 0.50, (1.00, 0.95, 0.88), 40.0),
    "door_steel":     ((0.46, 0.47, 0.44), 0.0, 0.45, None, 0.0),       # RAL 7035 painted
    "door_frame":     ((0.06, 0.06, 0.065), 0.2, 0.50, None, 0.0),
    "glass":          ((0.80, 0.86, 0.86), 0.0, 0.03, None, 0.0),
    "polycarbonate":  ((0.82, 0.86, 0.90), 0.0, 0.08, None, 0.0),
}

# Transparent presets: alpha < 1 (Principled Alpha -> glTF alphaMode BLEND).
ALPHA = {"glass": 0.15, "polycarbonate": 0.22, "hotspot": 0.0}


def get(name):
    """Return the preset material `name`, creating it on first use."""
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat
    if name not in PRESETS:                      # texture-set material (ambientCG)
        from . import textures
        return textures.get(name)
    base, metallic, rough, emit, strength = PRESETS[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*base, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = rough
    if emit is not None:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    if name in ALPHA:
        bsdf.inputs["Alpha"].default_value = ALPHA[name]
        mat.surface_render_method = "BLENDED"
    mat.diffuse_color = (*base, 1.0)  # viewport colour
    return mat
