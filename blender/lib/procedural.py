"""Procedural, seamlessly tiling PBR materials (Principled BSDF only).

Every texture is evaluated on a 4D torus built from the UV coordinates
(cos/sin of u and v), so one UV unit (= `tile_m` metres, see uvtools.box_project)
tiles without seams. bake.py turns them into image textures for glTF; the
material carries mat["leyonet_bake"] = {"tile_m", "res"} for that.
"""
import math

import bpy

TAU = 2 * math.pi


class _G:
    """Tiny node-graph helper."""

    def __init__(self, mat):
        self.nt = mat.node_tree
        self.n = self.nt.nodes
        self.l = self.nt.links
        self.x = -1400

    def node(self, kind, **props):
        nd = self.n.new(kind)
        nd.location = (self.x, 0)
        self.x += 40
        for k, v in props.items():
            setattr(nd, k, v)
        return nd

    def _in(self, nd, idx, val):
        if hasattr(val, "is_output"):
            self.l.new(val, nd.inputs[idx])
        else:
            nd.inputs[idx].default_value = val

    def math(self, op, a, b=0.0, clamp=False):
        nd = self.node("ShaderNodeMath", operation=op, use_clamp=clamp)
        self._in(nd, 0, a)
        self._in(nd, 1, b)
        return nd.outputs[0]

    def madd(self, a, mul, add):
        """a * mul + add"""
        nd = self.node("ShaderNodeMath", operation="MULTIPLY_ADD")
        self._in(nd, 0, a)
        self._in(nd, 1, mul)
        self._in(nd, 2, add)
        return nd.outputs[0]

    def maprange(self, val, fmin, fmax, tmin, tmax, smooth=True):
        nd = self.node("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP" if smooth else "LINEAR",
                       clamp=True)
        self._in(nd, "Value", val)
        nd.inputs["From Min"].default_value = fmin
        nd.inputs["From Max"].default_value = fmax
        nd.inputs["To Min"].default_value = tmin
        nd.inputs["To Max"].default_value = tmax
        return nd.outputs["Result"]

    def torus(self):
        """(vector, w) sockets: seamless 4D coordinates, circumference 1 per UV unit."""
        uv = self.node("ShaderNodeTexCoord").outputs["UV"]
        sep = self.node("ShaderNodeSeparateXYZ")
        self.l.new(uv, sep.inputs[0])
        r = 1.0 / TAU
        u = self.math("MULTIPLY", sep.outputs[0], TAU)
        v = self.math("MULTIPLY", sep.outputs[1], TAU)
        comb = self.node("ShaderNodeCombineXYZ")
        self.l.new(self.math("MULTIPLY", self.math("COSINE", u), r), comb.inputs[0])
        self.l.new(self.math("MULTIPLY", self.math("SINE", u), r), comb.inputs[1])
        self.l.new(self.math("MULTIPLY", self.math("COSINE", v), r), comb.inputs[2])
        w = self.math("MULTIPLY", self.math("SINE", v), r)
        return comb.outputs[0], w

    def noise(self, co, scale, detail=2.0, rough=0.5, distortion=0.0):
        vec, w = co
        nd = self.node("ShaderNodeTexNoise", noise_dimensions="4D")
        self.l.new(vec, nd.inputs["Vector"])
        self.l.new(w, nd.inputs["W"])
        nd.inputs["Scale"].default_value = scale
        nd.inputs["Detail"].default_value = detail
        nd.inputs["Roughness"].default_value = rough
        nd.inputs["Distortion"].default_value = distortion
        return nd.outputs["Fac"]

    def voronoi(self, co, scale, randomness=1.0):
        vec, w = co
        nd = self.node("ShaderNodeTexVoronoi", voronoi_dimensions="4D", feature="F1")
        self.l.new(vec, nd.inputs["Vector"])
        self.l.new(w, nd.inputs["W"])
        nd.inputs["Scale"].default_value = scale
        nd.inputs["Randomness"].default_value = randomness
        return nd.outputs["Distance"]

    def ramp(self, val, stops):
        nd = self.node("ShaderNodeValToRGB")
        self.l.new(val, nd.inputs[0])
        els = nd.color_ramp.elements
        while len(els) < len(stops):
            els.new(0.5)
        for el, (pos, col) in zip(els, stops):
            el.position = pos
            el.color = (*col, 1.0)
        return nd.outputs["Color"]


def _new(name, tile_m, res):
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat, None
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat["leyonet_bake"] = {"tile_m": tile_m, "res": res}
    return mat, _G(mat)


def _finish(g, mat, base, rough, height, bump_strength, bump_dist, viewport):
    bsdf = g.n["Principled BSDF"]
    g.l.new(base, bsdf.inputs["Base Color"])
    g.l.new(rough, bsdf.inputs["Roughness"])
    bump = g.node("ShaderNodeBump")
    bump.inputs["Strength"].default_value = bump_strength
    bump.inputs["Distance"].default_value = bump_dist
    g.l.new(height, bump.inputs["Height"])
    g.l.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Metallic"].default_value = 0.0
    mat.diffuse_color = (*viewport, 1.0)
    return mat


def sponge_rubber(name="floor_sponge_rubber", tile_m=1.0, res=2048):
    """Dark anthracite sponge-rubber floor: fine closed pores, grain, mottling."""
    mat, g = _new(name, tile_m, res)
    if g is None:
        return mat
    co = g.torus()
    big = g.noise(co, 4.0, detail=3.0, rough=0.55)
    grain = g.noise(co, 220.0, detail=2.0, rough=0.6)
    # pores: small voronoi cells, density/size varying with a mid-frequency noise
    # cell distances are in cell units: 160 cells/tile -> 6.25 mm cells
    vor = g.voronoi(co, 160.0)
    size = g.maprange(g.noise(co, 30.0), 0.35, 0.65, 0.18, 0.40, smooth=False)
    pore = g.maprange(g.math("DIVIDE", vor, size), 0.75, 1.0, 1.0, 0.0)
    vor2 = g.voronoi(co, 600.0)
    micro = g.maprange(vor2, 0.12, 0.25, 0.7, 0.0)
    pores = g.math("MAXIMUM", pore, micro)
    shade = g.madd(big, 0.7, 0.15)
    shade = g.math("ADD", shade, g.madd(grain, 0.35, -0.175))
    shade = g.math("SUBTRACT", shade, g.math("MULTIPLY", pores, 0.55), clamp=True)
    base = g.ramp(shade, [(0.0, (0.010, 0.010, 0.011)), (0.55, (0.045, 0.046, 0.049)),
                          (1.0, (0.085, 0.086, 0.091))])
    rough = g.math("ADD", g.madd(grain, 0.10, 0.80), g.math("MULTIPLY", pores, 0.12), clamp=True)
    height = g.math("SUBTRACT", g.math("MULTIPLY", grain, 0.15), pores)
    return _finish(g, mat, base, rough, height, 0.8, 0.002, (0.03, 0.03, 0.033))


def concrete(name="wall_concrete", tile_m=2.0, res=2048):
    """Fair-faced concrete: large mottling, fine sand grain, scattered air pores."""
    mat, g = _new(name, tile_m, res)
    if g is None:
        return mat
    co = g.torus()
    n1 = g.noise(co, 3.0, detail=4.0, rough=0.6, distortion=0.3)
    n2 = g.noise(co, 24.0, detail=6.0, rough=0.55)
    n3 = g.noise(co, 420.0, detail=2.0, rough=0.5)
    vor = g.voronoi(co, 160.0)            # 160 cells per 2 m tile -> 12.5 mm cells
    density = g.maprange(g.noise(co, 12.0), 0.42, 0.60, 0.0, 1.0)
    pore = g.math("MULTIPLY", g.maprange(vor, 0.07, 0.16, 1.0, 0.0), density)
    shade = g.madd(n1, 0.9, 0.05)
    shade = g.math("ADD", shade, g.madd(n2, 0.5, -0.25))
    shade = g.math("ADD", shade, g.madd(n3, 0.3, -0.15))
    shade = g.math("SUBTRACT", shade, g.math("MULTIPLY", pore, 0.6), clamp=True)
    base = g.ramp(shade, [(0.0, (0.13, 0.13, 0.125)), (0.5, (0.27, 0.27, 0.26)),
                          (1.0, (0.40, 0.40, 0.385))])
    rough = g.math("ADD", g.madd(n2, 0.2, 0.68), g.math("MULTIPLY", pore, 0.15), clamp=True)
    height = g.math("SUBTRACT", g.math("ADD", g.math("MULTIPLY", n2, 0.3),
                                       g.math("MULTIPLY", n3, 0.25)), pore)
    return _finish(g, mat, base, rough, height, 0.35, 0.002, (0.27, 0.27, 0.26))
