"""Assemble the exported assets into the editable full war-environment map."""

from __future__ import annotations

import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
GLB_DIR = ROOT / "public" / "assets" / "models"
OUT = ROOT / "art" / "blender" / "war_environment_master.blend"
PREVIEW = ROOT / "art" / "previews" / "war_environment_master.png"


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def import_asset(asset_id: str, name: str, location, scale=1.0, rotation_z=0.0):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(GLB_DIR / f"{asset_id}.glb"))
    added = [obj for obj in bpy.context.scene.objects if obj not in before]
    roots = [obj for obj in added if obj.parent is None]
    root = roots[0]
    root.name = name
    root.location = location
    root.scale = (scale, scale, scale)
    root.rotation_euler.z = rotation_z
    return root


def point_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def main():
    clear_scene()
    bpy.context.preferences.filepaths.save_version = 0
    import_asset("ocean_battlefield", "War Ocean", (0, 160, -1.2))
    import_asset("horizon_cliffs", "Horizon Cliffs", (0, 470, -4), 1.2)

    for i, (x, y, s) in enumerate(((-70, 70, 1.1), (82, 135, 0.85), (-115, 220, 1.35), (125, 310, 1.1))):
        import_asset("island", f"Fortified Island {i + 1}", (x, y, 0), s, i * 0.73)
    for i, (x, y, s) in enumerate(((-28, 42, 0.9), (35, 92, 0.75), (-64, 165, 1.0), (68, 260, 1.2))):
        import_asset("rock_stack", f"Rock Stack {i + 1}", (x, y, 0), s, i * 0.47)
    for i, (x, y) in enumerate(((-18, 25), (20, 55), (-40, 120), (48, 190))):
        import_asset("buoy", f"Channel Buoy {i + 1}", (x, y, 0), 0.9)

    import_asset("destroyer", "Patrol Destroyer", (62, 175, 0), 1.25, -0.16)
    import_asset("burning_wreck", "Burning Wreck", (-65, 105, 0), 1.1, 0.22)
    import_asset("searchlight_emplacement", "Searchlight West", (-88, 232, 1), 1.35)
    import_asset("searchlight_emplacement", "Searchlight East", (94, 285, 1), 1.35, math.pi)

    import_asset("player_fighter", "Player Fighter", (0, 20, 16), 4.0)
    import_asset("enemy_fighter", "Enemy Fighter", (-22, 92, 24), 3.0, math.pi)
    import_asset("enemy_interceptor", "Enemy Interceptor", (20, 122, 31), 3.0, math.pi)
    import_asset("enemy_bomber", "Enemy Bomber", (0, 175, 39), 3.0, math.pi)

    bpy.ops.object.light_add(type="SUN", location=(-40, -20, 90))
    sun = bpy.context.object
    sun.name = "Dawn Sun"
    sun.data.energy = 2.4
    sun.rotation_euler = (math.radians(28), math.radians(-18), math.radians(-32))
    bpy.ops.object.light_add(type="AREA", location=(0, -35, 55))
    fill = bpy.context.object
    fill.name = "Sky Fill"
    fill.data.energy = 1100
    fill.data.shape = "DISK"
    fill.data.size = 80
    point_at(fill, (0, 120, 0))

    bpy.ops.object.camera_add(location=(0, -72, 36))
    camera = bpy.context.object
    camera.name = "Playable Overview Camera"
    camera.data.lens = 34
    point_at(camera, (0, 145, 3))
    bpy.context.scene.camera = camera

    world = bpy.context.scene.world or bpy.data.worlds.new("War Sky")
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.035, 0.12, 0.28, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.65

    scene = bpy.context.scene
    scene["description"] = "Sky Strike complete Blender-authored ocean war environment"
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(PREVIEW)
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"

    bpy.ops.wm.save_as_mainfile(filepath=str(OUT), check_existing=False)
    bpy.ops.render.render(write_still=True)
    print(f"MASTER_OK {OUT}")
    print(f"PREVIEW_OK {PREVIEW}")


if __name__ == "__main__":
    main()
