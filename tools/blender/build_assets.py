"""Build the complete Sky Strike Blender asset library.

Run with:
  blender --background --python tools/blender/build_assets.py

Every exported gameplay/environment model is deliberately validated in the
10k-11k triangle band requested for the art pass.  The script also keeps the
editable .blend source beside the runtime GLB, making the art reproducible.
"""

from __future__ import annotations

import json
import math
import os
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
BLEND_DIR = ROOT / "art" / "blender"
GLB_DIR = ROOT / "public" / "assets" / "models"
PREVIEW_DIR = ROOT / "art" / "previews"
TARGET_TRIS = 10_500
MIN_TRIS = 10_000
MAX_TRIS = 11_000

BLEND_DIR.mkdir(parents=True, exist_ok=True)
GLB_DIR.mkdir(parents=True, exist_ok=True)
PREVIEW_DIR.mkdir(parents=True, exist_ok=True)


PALETTE = {
    "player_body": (0.72, 0.80, 0.90, 1),
    "player_panel": (0.20, 0.34, 0.50, 1),
    "cyan": (0.04, 0.62, 0.88, 1),
    "glass": (0.015, 0.08, 0.16, 1),
    "steel": (0.20, 0.25, 0.32, 1),
    "dark": (0.035, 0.05, 0.075, 1),
    "white": (0.82, 0.86, 0.90, 1),
    "red": (0.72, 0.06, 0.025, 1),
    "orange": (1.0, 0.23, 0.025, 1),
    "sand": (0.58, 0.42, 0.22, 1),
    "earth": (0.20, 0.12, 0.055, 1),
    "grass": (0.11, 0.26, 0.10, 1),
    "rock": (0.24, 0.27, 0.29, 1),
    "rock_light": (0.38, 0.40, 0.40, 1),
    "navy": (0.095, 0.14, 0.19, 1),
    "ship": (0.25, 0.31, 0.36, 1),
    "ship_light": (0.42, 0.49, 0.53, 1),
    "yellow": (0.92, 0.53, 0.03, 1),
    "purple": (0.43, 0.11, 0.83, 1),
    "water": (0.02, 0.20, 0.39, 1),
    "foam": (0.36, 0.68, 0.80, 1),
}


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        # Orphaned datablocks from the previous asset otherwise bloat later .blend files.
        for item in list(block):
            if item.users == 0:
                block.remove(item)


def material(name: str, color: tuple[float, float, float, float], metallic=0.15,
             roughness=0.34, emission: tuple[float, float, float, float] | None = None):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission:
        socket = bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")
        if socket:
            socket.default_value = emission
        strength = bsdf.inputs.get("Emission Strength")
        if strength:
            strength.default_value = 3.0
    return mat


def set_mat(obj, mat) -> None:
    obj.data.materials.append(mat)


def bevel(obj, width=0.06, segments=3) -> None:
    mod = obj.modifiers.new("Precision bevel", "BEVEL")
    mod.width = width
    mod.segments = segments


def cube(name, loc, scale, mat, bevel_width=0.05, bevel_segments=3):
    bpy.ops.mesh.primitive_cube_add(location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel_width:
        bevel(obj, bevel_width, bevel_segments)
    set_mat(obj, mat)
    return obj


def uv_sphere(name, loc, scale, mat, segments=48, rings=24):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    set_mat(obj, mat)
    return obj


def ico(name, loc, scale, mat, subdivisions=3):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    set_mat(obj, mat)
    return obj


def cylinder(name, loc, radius, depth, mat, vertices=48, axis="Z", bevel_width=0.025):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc)
    obj = bpy.context.object
    obj.name = name
    if axis == "Y":
        obj.rotation_euler.x = math.pi / 2
    elif axis == "X":
        obj.rotation_euler.y = math.pi / 2
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if bevel_width:
        bevel(obj, bevel_width, 2)
    set_mat(obj, mat)
    return obj


def cone(name, loc, r1, r2, depth, mat, vertices=48, axis="Z"):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=r1, radius2=r2, depth=depth, location=loc)
    obj = bpy.context.object
    obj.name = name
    if axis == "Y":
        obj.rotation_euler.x = math.pi / 2
    elif axis == "X":
        obj.rotation_euler.y = math.pi / 2
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bevel(obj, min(0.035, max(0.006, min(r1, max(r2, 0.01)) * 0.15)), 2)
    set_mat(obj, mat)
    return obj


def torus(name, loc, major, minor, mat, rotation=(0, 0, 0), major_segments=64, minor_segments=12):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major,
        minor_radius=minor,
        major_segments=major_segments,
        minor_segments=minor_segments,
        location=loc,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    set_mat(obj, mat)
    return obj


def prism(name: str, points: list[tuple[float, float]], z: float, thickness: float, mat, bevel_width=0.04):
    """Extrude a clean top-view polygon. Blender X/Y become Babylon X/Z."""
    n = len(points)
    verts = [(x, y, z - thickness / 2) for x, y in points] + [(x, y, z + thickness / 2) for x, y in points]
    faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, n * 2))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    if bevel_width:
        bevel(obj, bevel_width, 3)
    set_mat(obj, mat)
    return obj


def fin_prism(name, side, y, height, mat):
    x0 = 0.24 * side
    x1 = 0.42 * side
    points = [(x0, y + 0.45), (x1, y - 0.55), (x1, y - 0.92), (x0, y - 0.55)]
    fin = prism(name, points, height * 0.5, 0.09, mat, 0.025)
    fin.rotation_euler.y = side * -0.28
    return fin


def apply_modifiers(obj) -> None:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    for mod in list(obj.modifiers):
        try:
            bpy.ops.object.modifier_apply(modifier=mod.name)
        except RuntimeError:
            pass
    obj.select_set(False)


def triangle_count(obj) -> int:
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


def finalize_asset(asset_id: str):
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not objs:
        raise RuntimeError(f"{asset_id}: no geometry")
    for obj in objs:
        apply_modifiers(obj)

    bpy.ops.object.select_all(action="DESELECT")
    for obj in objs:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = f"ASSET_{asset_id}"

    tri = obj.modifiers.new("Runtime triangulation", "TRIANGULATE")
    tri.keep_custom_normals = True
    bpy.ops.object.modifier_apply(modifier=tri.name)

    # Preserve the authored silhouette, but densify sparse props before the
    # controlled reduction. SIMPLE subdivision does not change their shape.
    count = triangle_count(obj)
    while count < TARGET_TRIS * 1.18:
        sub = obj.modifiers.new("Density pass", "SUBSURF")
        sub.subdivision_type = "SIMPLE"
        sub.levels = 1
        sub.render_levels = 1
        bpy.ops.object.modifier_apply(modifier=sub.name)
        count = triangle_count(obj)

    if count > TARGET_TRIS:
        dec = obj.modifiers.new("Playable LOD", "DECIMATE")
        dec.decimate_type = "COLLAPSE"
        dec.ratio = TARGET_TRIS / count
        dec.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=dec.name)

    count = triangle_count(obj)
    if not MIN_TRIS <= count <= MAX_TRIS:
        raise RuntimeError(f"{asset_id}: {count} triangles outside {MIN_TRIS}-{MAX_TRIS}")

    for poly in obj.data.polygons:
        poly.use_smooth = True
    obj.data.set_sharp_from_angle(angle=math.radians(50))

    # Consistent custom properties survive into the GLB and are useful for QA.
    obj["asset_id"] = asset_id
    obj["triangle_count"] = count
    obj["lod"] = "medium"
    obj["forward_axis"] = "+Y (Babylon +Z after glTF conversion)"
    bpy.context.scene["asset_id"] = asset_id
    bpy.context.scene["triangle_count"] = count

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    return obj, count


def export_asset(asset_id: str, builder) -> dict:
    clear_scene()
    builder()
    obj, tris = finalize_asset(asset_id)

    blend_path = BLEND_DIR / f"{asset_id}.blend"
    glb_path = GLB_DIR / f"{asset_id}.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), check_existing=False)
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_animations=True,
        export_yup=True,
    )
    size = glb_path.stat().st_size
    print(f"ASSET_OK {asset_id}: {tris} tris, {size / 1024:.1f} KiB")
    return {
        "id": asset_id,
        "triangles": tris,
        "blend": str(blend_path.relative_to(ROOT)).replace("\\", "/"),
        "glb": str(glb_path.relative_to(ROOT)).replace("\\", "/"),
        "bytes": size,
    }


def jet_materials(prefix: str, body, panel, accent, glass=None):
    return {
        "body": material(prefix + "_Body", body, 0.72, 0.22),
        "panel": material(prefix + "_Panels", panel, 0.66, 0.28),
        "accent": material(prefix + "_Accent", accent, 0.52, 0.23),
        "glass": material(prefix + "_Canopy", glass or PALETTE["glass"], 0.35, 0.08),
        "dark": material(prefix + "_Dark", PALETTE["dark"], 0.62, 0.25),
        "engine": material(prefix + "_Engine", PALETTE["orange"], 0.1, 0.25, PALETTE["orange"]),
    }


def build_jet(prefix: str, girth=1.0, span=1.0, nose=1.0, armored=False,
              palette=(PALETTE["player_body"], PALETTE["player_panel"], PALETTE["cyan"])):
    m = jet_materials(prefix, palette[0], palette[1], palette[2])
    # Smooth area-ruled fuselage with a sharp radome and recessed twin engines.
    uv_sphere("Fuselage", (0, 0.05, 0.06), (0.52 * girth, 2.25, 0.44 * girth), m["body"], 64, 32)
    uv_sphere("ForwardShoulders", (0, 1.18, 0.04), (0.42 * girth, 1.35 * nose, 0.36 * girth), m["body"], 48, 24)
    cone("Radome", (0, 2.72 * nose, 0.02), 0.29 * girth, 0.015, 1.22 * nose, m["dark"], 64, "Y")
    torus("RecognitionBand", (0, 2.08 * nose, 0.02), 0.30 * girth, 0.025, m["accent"],
          (math.pi / 2, 0, 0), 48, 8)
    uv_sphere("Canopy", (0, 0.82, 0.42 * girth), (0.38 * girth, 0.82, 0.27), m["glass"], 48, 24)
    cube("Spine", (0, -0.48, 0.43), (0.17 * girth, 0.82, 0.10), m["panel"], 0.07, 4)

    wing_outline = [(0.24, 0.55), (2.72 * span, -0.42), (2.36 * span, -1.36), (0.35, -0.82)]
    stab_outline = [(0.18, -1.40), (1.18 * span, -1.82), (1.02 * span, -2.35), (0.20, -2.02)]
    for side in (-1, 1):
        pts = [(x * side, y) for x, y in wing_outline]
        prism(f"Wing_{side}", pts, 0.0, 0.10 if armored else 0.075, m["panel"], 0.055)
        pts = [(x * side, y) for x, y in stab_outline]
        prism(f"Stabilizer_{side}", pts, 0.14, 0.07, m["body"], 0.04)
        cube(f"Intake_{side}", (side * 0.48 * girth, 0.40, -0.12), (0.18 * girth, 0.58, 0.23), m["dark"], 0.07, 4)
        cylinder(f"Nozzle_{side}", (side * 0.25 * girth, -2.14, 0.0), 0.26 * girth, 0.52, m["dark"], 64, "Y", 0.025)
        torus(f"NozzleRing_{side}", (side * 0.25 * girth, -2.40, 0.0), 0.20 * girth, 0.045, m["engine"], (math.pi / 2, 0, 0), 48, 10)
        fin_prism(f"TailFin_{side}", side, -1.66, 0.95 if armored else 0.78, m["accent"])
        # Wing-root gun fairings / pylons make the silhouette read at phone scale.
        cylinder(f"GunPod_{side}", (side * 0.92 * span, 0.18, -0.11), 0.10, 1.16, m["dark"], 32, "Y", 0.018)
        if prefix == "Player":
            cylinder(f"WingMissile_{side}", (side * 2.18 * span, -0.63, -0.16), 0.075, 0.95, m["body"], 32, "Y", 0.012)
            cone(f"WingMissileNose_{side}", (side * 2.18 * span, -0.06, -0.16), 0.075, 0.006, 0.24, m["accent"], 32, "Y")

    # Recognition panels and believable maintenance access plates.
    for i, y in enumerate((1.45, 0.28, -0.65, -1.36)):
        cube(f"DorsalPanel_{i}", (0, y, 0.455), (0.26 * girth, 0.18, 0.018), m["accent"] if i == 1 else m["panel"], 0.018, 2)

    if armored:
        for side in (-1, 1):
            cube(f"ArmorCheek_{side}", (side * 0.54, -0.22, 0.06), (0.10, 0.92, 0.34), m["dark"], 0.06, 3)
            cube(f"WingArmor_{side}", (side * 1.22, -0.57, 0.09), (0.62, 0.40, 0.07), m["dark"], 0.045, 3)


def player_fighter():
    build_jet("Player", girth=1.0, span=1.0, nose=1.05, palette=(PALETTE["player_body"], PALETTE["player_panel"], PALETTE["cyan"]))


def enemy_fighter():
    build_jet("EnemyFighter", 0.96, 0.96, 0.96, False,
              ((0.48, 0.54, 0.61, 1), (0.18, 0.23, 0.28, 1), PALETTE["red"]))


def enemy_interceptor():
    build_jet("Interceptor", 0.76, 0.88, 1.28, False,
              ((0.68, 0.53, 0.38, 1), (0.34, 0.18, 0.09, 1), PALETTE["orange"]))


def enemy_bomber():
    build_jet("Bomber", 1.34, 1.14, 0.88, True,
              ((0.29, 0.33, 0.38, 1), (0.12, 0.15, 0.18, 1), (0.42, 0.04, 0.02, 1)))


def build_missile(hostile: bool):
    hull = material("MissileHull", PALETTE["steel"] if hostile else PALETTE["white"], 0.65, 0.2)
    accent_color = PALETTE["red"] if hostile else PALETTE["cyan"]
    accent = material("MissileWarning", accent_color, 0.35, 0.22)
    dark = material("MissileMechanics", PALETTE["dark"], 0.7, 0.2)
    hot = material("MissileExhaust", PALETTE["orange"], 0.1, 0.22, PALETTE["orange"])
    cylinder("MotorCase", (0, 0, 0), 0.16 if hostile else 0.13, 1.65, hull, 64, "Y", 0.025)
    cone("Seeker", (0, 1.02, 0), 0.16 if hostile else 0.13, 0.008, 0.52, accent, 64, "Y")
    cylinder("Exhaust", (0, -0.92, 0), 0.12, 0.18, dark, 48, "Y", 0.012)
    torus("ExhaustGlow", (0, -1.02, 0), 0.09, 0.022, hot, (math.pi / 2, 0, 0), 48, 10)
    for axis in range(4):
        a = axis * math.pi / 2
        x, z = math.cos(a) * 0.19, math.sin(a) * 0.19
        fin = cube(f"ControlFin_{axis}", (x, -0.64, z), (0.22 if axis % 2 == 0 else 0.035, 0.24, 0.035 if axis % 2 == 0 else 0.22), accent, 0.028, 3)
        fin.rotation_euler.y = (axis % 2) * math.pi / 2
    for y in (-0.34, 0.20, 0.54):
        torus(f"ServiceBand_{y}", (0, y, 0), 0.145, 0.018, dark, (math.pi / 2, 0, 0), 48, 8)


def missile_player():
    build_missile(False)


def missile_enemy():
    build_missile(True)


def build_powerup(kind: str, color):
    shell = material(f"{kind}_Shell", PALETTE["dark"], 0.7, 0.2)
    glow = material(f"{kind}_Energy", color, 0.1, 0.18, color)
    trim = material(f"{kind}_Trim", PALETTE["white"], 0.72, 0.22)
    ico("EnergyCore", (0, 0, 0), (0.50, 0.50, 0.50), glow, 4)
    for rot in ((0, 0, 0), (math.pi / 2, 0, 0), (0, math.pi / 2, 0)):
        torus("ContainmentRing", (0, 0, 0), 0.72, 0.065, shell, rot, 64, 12)
    for i in range(6):
        a = i * math.pi / 3
        cube(f"Emitter_{i}", (math.cos(a) * 0.72, math.sin(a) * 0.72, 0), (0.105, 0.105, 0.14), trim, 0.035, 3)
    if kind == "heavy":
        for side in (-1, 1):
            cylinder(f"AmmoDrum_{side}", (side * 0.42, 0, 0), 0.18, 0.36, shell, 32, "X", 0.018)
    elif kind == "missiles":
        for side in (-1, 1):
            cone(f"MiniMissile_{side}", (side * 0.30, 0, 0), 0.14, 0.015, 0.60, trim, 32, "Y")
    else:
        torus("GhostHalo", (0, 0, 0), 0.88, 0.035, glow, (math.pi / 4, 0, 0), 64, 10)


def powerup_heavy():
    build_powerup("heavy", PALETTE["orange"])


def powerup_missiles():
    build_powerup("missiles", PALETTE["cyan"])


def powerup_ghost():
    build_powerup("ghost", PALETTE["purple"])


def island():
    sand = material("IslandSand", PALETTE["sand"], 0.0, 0.82)
    earth = material("IslandEarth", PALETTE["earth"], 0.0, 0.9)
    grass = material("IslandGrass", PALETTE["grass"], 0.0, 0.88)
    rock = material("IslandRock", PALETTE["rock"], 0.05, 0.75)
    bunker = material("BunkerConcrete", (0.23, 0.25, 0.22, 1), 0.05, 0.82)
    cylinder("BeachShelf", (0, 0, 0), 12.0, 1.2, sand, 64, "Z", 0.45)
    ico("MainHill", (0, 0.4, 2.1), (7.8, 6.0, 3.2), grass, 4)
    ico("Cliff", (-3.2, -0.9, 2.6), (3.9, 3.3, 3.5), rock, 3)
    ico("Cliff2", (4.1, 0.8, 1.8), (3.4, 2.8, 2.3), earth, 3)
    cube("CoastalBunker", (2.2, -2.6, 3.1), (1.6, 1.25, 0.65), bunker, 0.28, 4)
    cube("BunkerSlot", (2.2, -3.87, 3.22), (0.75, 0.06, 0.13), material("BunkerDark", PALETTE["dark"], 0, 0.9), 0.02, 2)
    for i in range(7):
        a = i * 2.3
        ico(f"ShoreRock_{i}", (math.cos(a) * (8.2 + i * 0.22), math.sin(a) * (7.1 + i * 0.16), 0.8),
            (1.0 + i * 0.08, 0.8 + i * 0.05, 0.9 + i * 0.06), rock, 2)


def rock_stack():
    dark = material("WetRock", PALETTE["rock"], 0.05, 0.64)
    light = material("RockFace", PALETTE["rock_light"], 0.03, 0.78)
    for i, (x, y, z, s) in enumerate((
        (0, 0, 1.5, 2.5), (1.9, -0.4, 1.0, 1.8), (-1.7, 0.7, 1.2, 2.0),
        (0.6, 1.4, 2.5, 1.6), (-0.7, -1.0, 3.0, 1.5), (1.1, 0.3, 3.8, 1.1),
    )):
        obj = ico(f"Rock_{i}", (x, y, z), (s, s * 0.78, s * (0.72 + i * 0.03)), light if i % 2 else dark, 3)
        obj.rotation_euler = (0.11 * i, 0.17 * i, 0.29 * i)
    for i in range(4):
        torus(f"WaterLine_{i}", ((i - 1.5) * 1.1, 0, 0.35 + i * 0.08), 0.7 + i * 0.13, 0.05, light,
              (0, 0, 0), 48, 8)


def buoy():
    red = material("BuoyRed", PALETTE["red"], 0.4, 0.3)
    dark = material("BuoySteel", PALETTE["dark"], 0.75, 0.22)
    yellow = material("Beacon", PALETTE["yellow"], 0.1, 0.2, PALETTE["yellow"])
    cone("Float", (0, 0, 1.15), 0.95, 0.58, 2.3, red, 64, "Z")
    torus("Fender", (0, 0, 0.45), 0.85, 0.12, dark, (0, 0, 0), 64, 12)
    cylinder("Tower", (0, 0, 2.95), 0.12, 2.3, dark, 48, "Z", 0.018)
    for i in range(3):
        a = i * math.tau / 3
        bar = cylinder(f"Brace_{i}", (math.cos(a) * 0.32, math.sin(a) * 0.32, 2.35), 0.045, 1.75, dark, 24, "Z", 0.008)
        bar.rotation_euler.x = math.sin(a) * 0.35
        bar.rotation_euler.y = math.cos(a) * 0.35
    cylinder("Lamp", (0, 0, 4.25), 0.26, 0.42, yellow, 48, "Z", 0.04)
    torus("GuardTop", (0, 0, 4.54), 0.37, 0.035, dark, (0, 0, 0), 48, 8)


def searchlight_emplacement():
    concrete = material("SearchlightConcrete", (0.28, 0.29, 0.27, 1), 0.0, 0.86)
    steel = material("SearchlightSteel", PALETTE["steel"], 0.78, 0.22)
    dark = material("SearchlightDark", PALETTE["dark"], 0.7, 0.28)
    lens = material("SearchlightLens", (0.55, 0.72, 0.92, 1), 0.05, 0.08, (0.22, 0.40, 0.75, 1))
    cylinder("BunkerBase", (0, 0, 0.65), 2.25, 1.3, concrete, 64, "Z", 0.22)
    cylinder("Turntable", (0, 0, 1.45), 1.15, 0.36, steel, 64, "Z", 0.08)
    for side in (-1, 1):
        cube(f"Yoke_{side}", (side * 0.86, 0, 2.35), (0.10, 0.44, 0.92), steel, 0.08, 4)
        cylinder(f"Pivot_{side}", (side * 0.96, 0, 2.45), 0.18, 0.26, dark, 48, "X", 0.025)
    cylinder("LampHousing", (0, 0.08, 2.55), 0.84, 1.32, dark, 64, "Y", 0.08)
    cylinder("Lens", (0, 0.79, 2.55), 0.72, 0.08, lens, 64, "Y", 0.015)
    torus("LensGuard", (0, 0.84, 2.55), 0.73, 0.045, steel, (math.pi / 2, 0, 0), 64, 10)
    for i in range(6):
        a = i * math.tau / 6
        cylinder(f"LensBar_{i}", (math.cos(a) * 0.53, 0.90, 2.55 + math.sin(a) * 0.53), 0.022, 1.15, steel, 16, "X", 0.005)


def hull_prism(name, length, width, height, mat, broken=False):
    pts = [(-length * 0.52, -width * 0.34), (-length * 0.32, -width * 0.5),
           (length * 0.36, -width * 0.47), (length * 0.55, 0),
           (length * 0.36, width * 0.47), (-length * 0.32, width * 0.5),
           (-length * 0.52, width * 0.34)]
    return prism(name, pts, height * 0.5, height, mat, 0.18 if not broken else 0.08)


def burning_wreck():
    hull = material("WreckHull", (0.055, 0.065, 0.075, 1), 0.5, 0.62)
    rust = material("WreckRust", (0.22, 0.065, 0.02, 1), 0.15, 0.82)
    char = material("WreckChar", (0.012, 0.012, 0.014, 1), 0.0, 0.95)
    hot = material("WreckHot", PALETTE["orange"], 0.0, 0.3, PALETTE["orange"])
    hull_prism("BrokenHull", 17, 5.2, 2.8, hull, True)
    # Listing superstructure, torn ribs, collapsed mast, and a visible fire pocket.
    deck = cube("CollapsedDeck", (1.0, -0.2, 2.8), (3.4, 1.7, 0.65), rust, 0.14, 3)
    deck.rotation_euler.y = -0.13
    for i in range(8):
        x = -5.5 + i * 1.45
        rib = torus(f"ExposedRib_{i}", (x, 0, 2.0), 1.45, 0.075, rust, (math.pi / 2, 0, 0), 32, 8)
        rib.scale.y = 0.7
    mast = cylinder("FallenMast", (2.6, 0, 5.0), 0.14, 8.5, char, 32, "Z", 0.025)
    mast.rotation_euler.y = -0.72
    ico("FirePocket", (-0.8, 0, 3.1), (0.85, 0.65, 0.75), hot, 3)
    for i in range(10):
        a = i * 1.7
        ico(f"Debris_{i}", (math.cos(a) * (3.5 + i * 0.25), math.sin(a) * 2.2, 0.7 + (i % 3) * 0.25),
            (0.34 + i * 0.03, 0.22 + i * 0.02, 0.28), rust if i % 2 else char, 2)


def destroyer():
    hull = material("DestroyerHull", PALETTE["ship"], 0.62, 0.3)
    deck = material("DestroyerDeck", PALETTE["ship_light"], 0.55, 0.36)
    dark = material("DestroyerDark", PALETTE["dark"], 0.7, 0.25)
    glass = material("BridgeGlass", PALETTE["glass"], 0.3, 0.08)
    hull_prism("DestroyerHull", 24, 6.0, 3.0, hull)
    cube("MainDeck", (0, 0, 2.15), (7.8, 2.25, 0.35), deck, 0.16, 3)
    cube("BridgeLower", (1.8, 0, 3.1), (2.4, 1.65, 0.75), hull, 0.14, 3)
    cube("BridgeUpper", (2.3, 0, 4.25), (1.45, 1.20, 0.52), deck, 0.11, 3)
    for side in (-1, 1):
        cube(f"BridgeWindow_{side}", (2.35, side * 1.22, 4.36), (0.82, 0.035, 0.18), glass, 0.015, 2)
        cylinder(f"Lifeboat_{side}", (0.5, side * 1.9, 3.15), 0.30, 2.3, material("Lifeboat", PALETTE["orange"], 0.25, 0.45), 32, "Y", 0.05)
    for idx, y in enumerate((-6.4, 6.0)):
        cylinder(f"TurretBase_{idx}", (y, 0, 3.0), 1.05, 0.58, dark, 48, "Z", 0.09)
        cube(f"Turret_{idx}", (y, 0, 3.65), (0.92, 0.92, 0.43), hull, 0.13, 3)
        for side in (-1, 1):
            barrel = cylinder(f"Barrel_{idx}_{side}", (y + (1.65 if idx == 1 else -1.65), side * 0.28, 3.92), 0.085, 3.1, dark, 32, "X", 0.012)
            barrel.rotation_euler.y = -0.08 if idx == 1 else 0.08
    cylinder("Mast", (2.1, 0, 7.05), 0.11, 5.0, dark, 32, "Z", 0.018)
    torus("Radar", (2.1, 0, 8.1), 0.86, 0.04, deck, (math.pi / 2, 0, 0), 48, 8)
    for i in range(4):
        a = i * math.pi / 2
        cube(f"MissileCell_{i}", (-1.6 + (i % 2) * 0.8, -0.45 + (i // 2) * 0.9, 3.0), (0.28, 0.28, 0.42), dark, 0.035, 2)


def ocean_battlefield():
    water = material("OceanWater", PALETTE["water"], 0.35, 0.18)
    n = 73  # 72*72*2 = 10,368 triangles: naturally inside the target band.
    size = 1600.0
    verts = []
    faces = []
    for iz in range(n):
        y = -size / 2 + size * iz / (n - 1)
        for ix in range(n):
            x = -size / 2 + size * ix / (n - 1)
            z = math.sin(x * 0.055 + y * 0.018) * 0.42 + math.sin(y * 0.071 - x * 0.012) * 0.20
            verts.append((x, y, z))
    for iz in range(n - 1):
        for ix in range(n - 1):
            a = iz * n + ix
            faces.append((a, a + 1, a + n + 1))
            faces.append((a, a + n + 1, a + n))
    mesh = bpy.data.meshes.new("OceanBattlefieldMesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    uv_layer = mesh.uv_layers.new(name="OceanUV")
    for poly in mesh.polygons:
        for loop_index in poly.loop_indices:
            vx, vy, _ = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            uv_layer.data[loop_index].uv = (vx / size + 0.5, vy / size + 0.5)
    obj = bpy.data.objects.new("OceanBattlefield", mesh)
    bpy.context.collection.objects.link(obj)
    set_mat(obj, water)


def horizon_cliffs():
    far = material("FarCliffs", (0.28, 0.36, 0.44, 1), 0.0, 0.88)
    near = material("NearCliffs", (0.16, 0.23, 0.29, 1), 0.0, 0.9)
    # Layered island chain; the long silhouette replaces the old painted plane.
    for i in range(23):
        x = -330 + i * 30
        y = 0.0 + math.sin(i * 1.7) * 8
        height = 12 + (math.sin(i * 2.31) + 1) * 8
        obj = ico(f"FarPeak_{i}", (x, y, height * 0.34), (24 + (i % 3) * 7, 15, height), far, 2)
        obj.rotation_euler.z = i * 0.37
    for i in range(16):
        x = -300 + i * 40
        height = 8 + (math.sin(i * 1.41) + 1) * 7
        obj = ico(f"NearPeak_{i}", (x, -9, height * 0.25), (30, 18, height), near, 2)
        obj.rotation_euler.z = i * 0.29


ASSETS = [
    ("player_fighter", player_fighter),
    ("enemy_fighter", enemy_fighter),
    ("enemy_interceptor", enemy_interceptor),
    ("enemy_bomber", enemy_bomber),
    ("missile_player", missile_player),
    ("missile_enemy", missile_enemy),
    ("powerup_heavy", powerup_heavy),
    ("powerup_missiles", powerup_missiles),
    ("powerup_ghost", powerup_ghost),
    ("island", island),
    ("rock_stack", rock_stack),
    ("buoy", buoy),
    ("searchlight_emplacement", searchlight_emplacement),
    ("burning_wreck", burning_wreck),
    ("destroyer", destroyer),
    ("ocean_battlefield", ocean_battlefield),
    ("horizon_cliffs", horizon_cliffs),
]


def main() -> None:
    bpy.context.scene.render.engine = "BLENDER_EEVEE"
    bpy.context.preferences.filepaths.save_version = 0
    manifest = {
        "generator": "Blender 5.2 / tools/blender/build_assets.py",
        "triangleRange": [MIN_TRIS, MAX_TRIS],
        "assets": [],
    }
    only = set(sys.argv[sys.argv.index("--") + 1:]) if "--" in sys.argv else set()
    for asset_id, builder in ASSETS:
        if only and asset_id not in only:
            continue
        manifest["assets"].append(export_asset(asset_id, builder))

    manifest_path = GLB_DIR / "asset-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"MANIFEST_OK {manifest_path}")


if __name__ == "__main__":
    main()
