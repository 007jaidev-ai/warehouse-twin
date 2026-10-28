"""Blender scene of the picking floor, built from the same geometry as the web app.

Run inside Blender (Text editor or the MCP bridge):
    exec(open(r"<repo>/build/blender/scene.py").read())
then call build(), bake_floor(), render_hero(layout) — see the bottom of the file.

Coordinates: web (Three.js) x, y-up, z  ->  Blender (x, -z, y). A proper rotation, so renders are not mirrored.
"""
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(r"C:\Users\ASUS\Documents\Studies\ElectroSolve")
HERE = ROOT / "build" / "blender"
D = json.loads((HERE / "scene.json").read_text())
CFG = D["cfg"]
LEVELS = [0.12, 0.82, 1.52]
CARTON_H = 0.55
FONT = r"C:\Windows\Fonts\bahnschrift.ttf"

# ---- design tokens (shared with web/src/style.css) ----
PAL = {
    "floor": "#E3DFD6", "walk": "#EEEBE4", "ink": "#1F2226", "graphite": "#3B3F45", "steel": "#B9BCBE",
    "safety": "#E9AE0C", "signal": "#E0442A", "cobalt": "#2340B8", "kraft": "#C9A97A", "paper": "#F4F1EA",
}
RAMP = ["#D7D3C8", "#A9C3BB", "#4E978A", "#EDB23A", "#E0442A"]


def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)


def ramp(v):
    v = max(0.0, min(1.0, v)) * (len(RAMP) - 1)
    i = min(int(v), len(RAMP) - 2)
    a, b = srgb(RAMP[i]), srgb(RAMP[i + 1])
    f = v - i
    return tuple(a[k] + (b[k] - a[k]) * f for k in range(3)) + (1.0,)


def B(x, y, z):  # web -> blender
    return Vector((x, -z, y))


def coll(name):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
    return c


def mat(name, color, rough=0.6, metal=0.0, emit=None):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = srgb(color) if isinstance(color, str) else color
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit:
        bsdf.inputs["Emission Color"].default_value = srgb(emit[0])
        bsdf.inputs["Emission Strength"].default_value = emit[1]
    m.diffuse_color = srgb(color) if isinstance(color, str) else color
    return m


def box(name, c, center, size, material, bevel=0.0):
    """center/size in web coords (x, y, z), size = (w along x, h along y, d along z)."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=B(*center))
    o = bpy.context.active_object
    o.name = name
    o.scale = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(material)
    if bevel:
        m = o.modifiers.new("bevel", "BEVEL")
        m.width = bevel
        m.segments = 2
    for cc in o.users_collection:
        cc.objects.unlink(o)
    c.objects.link(o)
    return o


def plane(name, c, cx, cz, w, d, material, y=0.0):
    bpy.ops.mesh.primitive_plane_add(size=1, location=B(cx, y, cz))
    o = bpy.context.active_object
    o.name = name
    o.scale = (w, d, 1)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(material)
    for cc in o.users_collection:
        cc.objects.unlink(o)
    c.objects.link(o)
    return o


def label(name, c, text, x, z, size, material, rot=0.0, y=0.004, align="CENTER"):
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = text
    cu.font = bpy.data.fonts.load(FONT, check_existing=True)
    cu.size = size
    cu.align_x = align
    cu.align_y = "CENTER"
    o = bpy.data.objects.new(name, cu)
    o.location = B(x, y, z)
    o.rotation_euler = (0, 0, rot)
    o.data.materials.append(material)
    c.objects.link(o)
    return o


def clear():
    for c in list(bpy.data.collections):
        if c.name.startswith("WH_"):
            for o in list(c.objects):
                bpy.data.objects.remove(o, do_unlink=True)
            bpy.data.collections.remove(c)
    for o in list(bpy.data.objects):  # startup cube, lights, cameras from earlier runs
        if not any(c.name.startswith("WH_") for c in o.users_collection) and o.type not in ("CAMERA", "LIGHT"):
            bpy.data.objects.remove(o, do_unlink=True)


# --------------------------------------------------------------------------------------------
def build():
    clear()
    W, depth, fz, bz = D["width"], D["depth"], D["frontZ"], D["backZ"]
    cx = W / 2
    cw, aw, rd, bw, rh = CFG["crossW"], CFG["aisleW"], CFG["rackD"], CFG["bayW"], CFG["rackH"]

    cFloor, cMark, cRack, cCarton, cDock, cPicker = (coll(n) for n in
        ("WH_floor", "WH_marks", "WH_racks", "WH_cartons", "WH_dock", "WH_picker"))

    # floor (subtle concrete: noise into colour)
    fm = mat("floor", PAL["floor"], rough=0.85)
    nt = fm.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    noise = nt.nodes.new("ShaderNodeTexNoise")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    nt.links.new(tc.outputs["Object"], noise.inputs["Vector"])
    noise.inputs["Scale"].default_value = 0.6
    noise.inputs["Detail"].default_value = 6
    cr = nt.nodes.new("ShaderNodeValToRGB")
    cr.color_ramp.elements[0].color = srgb("#DFDBD2")
    cr.color_ramp.elements[1].color = srgb("#E6E2DA")
    nt.links.new(noise.outputs["Fac"], cr.inputs["Fac"])
    nt.links.new(cr.outputs["Color"], bsdf.inputs["Base Color"])
    plane("floor", cFloor, cx, (fz + bz) / 2 - 4, W + 60, bz - fz + 60, fm)

    walk = mat("walk", PAL["walk"], rough=0.8)
    safety = mat("safety", PAL["safety"], rough=0.55)
    ink = mat("ink", PAL["ink"], rough=0.6)
    inkSoft = mat("inkSoft", "#9D978A", rough=0.7)

    # walkways = aisles + cross-aisles, painted slightly lighter, bordered with safety yellow
    plane("cross_front", cMark, cx, fz, W, cw, walk, y=0.001)
    plane("cross_back", cMark, cx, bz, W, cw, walk, y=0.001)
    for a, x in enumerate(D["aisleX"]):
        plane(f"aisle{a}", cMark, x, depth / 2, aw, depth, walk, y=0.001)
        for dx in (-1, 1):
            plane(f"aline{a}{dx}", cMark, x + dx * (aw / 2 - 0.1), depth / 2, 0.07, depth, safety, y=0.002)
        # big stencil aisle number at the front entry, read from the dock
        label(f"anum{a}", cMark, f"{CFG['aisles'] - a:02d}", x, fz + 0.1, 1.15, inkSoft, rot=math.pi)
        # bay ticks along the aisle centre-line
        for b in range(CFG["bays"] + 1):
            plane(f"tick{a}_{b}", cMark, x, b * bw, 0.5, 0.035, inkSoft, y=0.002)
    for z in (fz - cw / 2 + 0.1, bz + cw / 2 - 0.1):
        plane(f"xline{z:.1f}", cMark, cx, z, W, 0.07, safety, y=0.002)

    # dock apron: hatched safety zone + label
    dock = D["dock"]
    dz = dock[1]
    plane("apron", cMark, dock[0], dz - 1.0, 10.5, 4.2, mat("apron", "#D8D2C4", rough=0.85), y=0.0015)
    for i in range(-11, 12):
        o = plane(f"hatch{i}", cMark, dock[0] + i * 0.45, dz + 0.95, 0.16, 0.75, safety, y=0.0025)
        o.rotation_euler[2] = math.radians(35)
    label("dock_lbl", cMark, "PACK & DISPATCH", dock[0], dz - 3.55, 0.42, ink, rot=math.pi)

    # racks: graphite uprights, safety-yellow step beams, galvanised decks
    gm = mat("graphite", PAL["graphite"], rough=0.45, metal=0.3)
    bm = mat("beam", PAL["signal"], rough=0.5, metal=0.1)
    dm = mat("deck", PAL["steel"], rough=0.5, metal=0.5)
    rows = sorted({round(s["x"], 3) for s in D["slots"]})
    for ri, x in enumerate(rows):
        for b in range(CFG["bays"] + 1):
            for dx in (-rd / 2 + 0.04, rd / 2 - 0.04):
                box(f"up{ri}_{b}_{dx:.2f}", cRack, (x + dx, rh / 2, b * bw), (0.07, rh, 0.07), gm)
        for y in LEVELS:
            for dx in (-rd / 2 + 0.035, rd / 2 - 0.035):
                box(f"beam{ri}_{y}_{dx:.2f}", cRack, (x + dx, y - 0.05, depth / 2), (0.05, 0.1, depth), bm)
            box(f"deck{ri}_{y}", cRack, (x, y - 0.01, depth / 2), (rd - 0.1, 0.02, depth), dm)

    # cartons (one object per slot so each can take its own heat colour)
    for s in D["slots"]:
        for l, y in enumerate(LEVELS):
            o = box(f"carton{s['id']}_{l}", cCarton, (s["x"], y + CARTON_H / 2, s["z"]),
                    (rd * 0.78, CARTON_H, bw * 0.82), mat(f"carton{s['id']}", "#cccccc", rough=0.7), bevel=0.012)

    # dock furniture
    box("dock_base", cDock, (dock[0], 0.06, dz - 1.4), (9, 0.12, 2.6), mat("dockbase", "#C8C2B4", rough=0.7))
    tm = mat("table", PAL["paper"], rough=0.5)
    for dx in (-3, 0, 3):
        box(f"table{dx}", cDock, (dock[0] + dx, 0.86, dz - 2.0), (2.2, 0.05, 0.95), tm)
        for lx in (-1.0, 1.0):
            box(f"tleg{dx}{lx}", cDock, (dock[0] + dx + lx, 0.43, dz - 2.0), (0.05, 0.84, 0.85), gm)
        box(f"parcel{dx}", cDock, (dock[0] + dx - 0.4, 1.03, dz - 2.0), (0.45, 0.3, 0.4), mat("kraft", PAL["kraft"], 0.8), bevel=0.01)

    # picker + cart (stylised)
    px, pz = dock[0] + 0.4, fz + 0.2
    vest = mat("vest", PAL["signal"], 0.6)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.22, depth=0.9, location=B(px, 0.95, pz))
    body = bpy.context.active_object
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.16, location=B(px, 1.6, pz))
    head = bpy.context.active_object
    head.data.materials.append(mat("skin", "#C79A74", 0.7))
    body.data.materials.append(vest)
    for o in (body, head):
        for cc in o.users_collection:
            cc.objects.unlink(o)
        cPicker.objects.link(o)
    box("cart", cPicker, (px, 0.55, pz + 0.8), (0.6, 0.4, 0.85), mat("cart", PAL["steel"], 0.4, 0.6), bevel=0.02)
    box("tote", cPicker, (px, 0.84, pz + 0.8), (0.5, 0.18, 0.75), mat("tote", PAL["cobalt"], 0.5), bevel=0.02)

    paint("original")
    print("built", len(bpy.data.objects), "objects")


def paint(layout):
    vis = D["layouts"][layout]["visits"]
    allv = [math.sqrt(v) for L in D["layouts"].values() for v in L["visits"]]
    lo, hi = min(allv), max(allv)
    for s in D["slots"]:
        m = bpy.data.materials[f"carton{s['id']}"]
        c = ramp((math.sqrt(vis[s["id"]]) - lo) / (hi - lo))
        next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Base Color"].default_value = c
        m.diffuse_color = c


def setup_world(strength=0.55):
    sc = bpy.context.scene
    w = sc.world or bpy.data.worlds.new("World")
    sc.world = w
    w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = srgb("#F2F0EB")
    bg.inputs["Strength"].default_value = strength
    sun = bpy.data.objects.get("sun")
    if sun is None:
        ld = bpy.data.lights.new("sun", "SUN")
        sun = bpy.data.objects.new("sun", ld)
        sc.collection.objects.link(sun)
    sun.data.energy = 2.6
    sun.data.angle = math.radians(9)
    sun.data.color = srgb("#FFFAF2")[:3]
    # same direction as the web app's key light: (18, 40, -24) in web coords
    dvec = B(18, 40, -24).normalized()
    sun.rotation_euler = (-dvec).to_track_quat("-Z", "Y").to_euler()


def engine(samples=128):
    sc = bpy.context.scene
    try:
        sc.render.engine = "CYCLES"
    except TypeError as e:
        print(e)
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    try:
        sc.cycles.device = "GPU"
    except Exception:
        pass
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"


def camera(name, loc, target, ortho=None, lens=50):
    cam = bpy.data.objects.get(name)
    if cam is None:
        cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
        bpy.context.scene.collection.objects.link(cam)
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    if ortho:
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = ortho
    else:
        cam.data.type = "PERSP"
        cam.data.lens = lens
    bpy.context.scene.camera = cam
    return cam


# floor texture for the web app: top-down, racks/cartons/dock cast shadow + AO but are not seen
BAKE = dict(x0=-6.0, x1=31.0, z0=-10.0, z1=27.0, px=2048)


def bake_floor(path=HERE / "floor_raw.png"):  # post-processed by build/blender/post.py
    sc = bpy.context.scene
    engine(256)
    setup_world()
    for cname in ("WH_racks", "WH_cartons", "WH_dock", "WH_picker"):
        for o in bpy.data.collections[cname].objects:
            o.visible_camera = False
            o.hide_render = cname == "WH_picker"
    x0, x1, z0, z1 = BAKE["x0"], BAKE["x1"], BAKE["z0"], BAKE["z1"]
    c = camera("cam_bake", B((x0 + x1) / 2, 60, (z0 + z1) / 2), B((x0 + x1) / 2, 0, (z0 + z1) / 2), ortho=x1 - x0)
    c.rotation_euler = (0, 0, 0)  # image up = blender +Y = web -z (dock at the top)
    sc.render.resolution_x = sc.render.resolution_y = BAKE["px"]
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGB"
    path.parent.mkdir(parents=True, exist_ok=True)
    sc.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    for cname in ("WH_racks", "WH_cartons", "WH_dock", "WH_picker"):
        for o in bpy.data.collections[cname].objects:
            o.visible_camera = True
            o.hide_render = False
    print("baked", path)


def render_hero(layout, path, w=2400, h=1500, view="axo", samples=160, transparent=True):
    sc = bpy.context.scene
    engine(samples)
    setup_world()
    paint(layout)
    cx, cz = D["width"] / 2, (D["frontZ"] + D["backZ"]) / 2
    tgt = B(cx, 0.6, cz - 1.5)
    if view == "axo":      # axonometric from the dock side, like an architect's drawing
        camera("cam_hero", tgt + B(-34, 40, -46).normalized() * 80, tgt, ortho=36)
    elif view == "detail":  # close-up on the dock and the first metres of the aisles
        t2 = B(cx - 1.5, 0.8, D["frontZ"] + 2.5)
        camera("cam_hero", t2 + B(-34, 40, -46).normalized() * 80, t2, ortho=15)
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.film_transparent = transparent
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA" if transparent else "RGB"
    sc.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    print("rendered", path)


def route(layout, color=PAL["cobalt"]):
    """Draw the sample order's walk as a tube on the floor, plus a pin over each picked slot."""
    c = coll("WH_route")
    for o in list(c.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    r = D["sampleRoute"][layout]
    cu = bpy.data.curves.new("route", "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = 0.11
    cu.bevel_resolution = 3
    sp = cu.splines.new("POLY")
    sp.points.add(len(r["pts"]) - 1)
    for i, (x, z) in enumerate(r["pts"]):
        sp.points[i].co = (*B(x, 0.14, z), 1)
    o = bpy.data.objects.new("route", cu)
    o.data.materials.append(mat("route", color, rough=0.4))
    c.objects.link(o)
    pin = mat("pin", PAL["ink"], rough=0.4)
    slots = {s["id"]: s for s in D["slots"]}
    for k, sid in enumerate(r["slots"]):
        s = slots[sid]
        bpy.ops.mesh.primitive_cone_add(radius1=0.32, depth=0.6, location=B(s["x"], CFG["rackH"] + 0.75, s["z"]), rotation=(math.pi, 0, 0))
        p = bpy.context.active_object
        p.name = f"pin{k}"
        p.data.materials.append(pin)
        for cc in p.users_collection:
            cc.objects.unlink(p)
        c.objects.link(p)


def clear_route():
    c = bpy.data.collections.get("WH_route")
    if c:
        for o in list(c.objects):
            bpy.data.objects.remove(o, do_unlink=True)


def render_plan(layout, path, px=1400, samples=96):
    """Top-down plan of the racks (transparent background) for small-multiple comparisons."""
    sc = bpy.context.scene
    engine(samples)
    setup_world()
    paint(layout)
    hide = [o for o in bpy.data.collections["WH_floor"].objects] + [o for o in bpy.data.collections["WH_marks"].objects]
    for o in hide:
        o.hide_render = True
    cx, cz = D["width"] / 2, (D["frontZ"] + D["backZ"]) / 2
    cam = camera("cam_plan", B(cx, 60, cz - 1.5), B(cx, 0, cz - 1.5), ortho=29)
    cam.rotation_euler = (0, 0, math.pi)  # dock at the bottom, aisle 01 on the left, as in the app
    sc.render.resolution_x, sc.render.resolution_y = px, int(px * 29 / 29)
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    for o in hide:
        o.hide_render = False
    print("plan", path)


OUT = HERE / "out"


def render_all(which=None, samples=128):
    """Every image used by the deck and the poster. which = list of names to (re)render, or None for all."""
    OUT.mkdir(exist_ok=True)
    jobs = {f"axo_{k}": (lambda k=k: (clear_route(), render_hero(k, OUT / f"axo_{k}.png", samples=samples)))
            for k in ("original", "abc", "affinity", "optimized")}
    for k in ("original", "optimized"):
        jobs[f"route_{k}"] = (lambda k=k: (route(k), render_hero(k, OUT / f"route_{k}.png", w=2000, h=1250, samples=samples)))
    jobs["detail"] = lambda: (route("optimized"), render_hero("optimized", OUT / "detail.png", w=2000, h=1400, view="detail", samples=samples))
    for name, fn in jobs.items():
        if which is None or name in which:
            fn()
    clear_route()
