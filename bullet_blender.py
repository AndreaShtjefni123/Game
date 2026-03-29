"""
Water Drop Bullet - Blender 5.x Python Script
==============================================
Scripting tab → Open this file → Run Script (Alt+P)

Creates a cute cartoon water droplet bullet with:
  - Classic teardrop / raindrop shape (round bottom, pointed top)
  - Glassy blue water material with transparency
  - White specular highlight dot
  - Small ripple ring at the base

IMPORTANT: Before exporting as .glb, delete the Camera & Lights first.
File → Export → glTF 2.0 (.glb) → save as bullet.glb in public/
"""

import bpy
import math

# ──────────────────────────────────────────────
# 0.  CLEAN THE SCENE
# ──────────────────────────────────────────────
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for block in bpy.data.meshes:
    if block.users == 0:
        bpy.data.meshes.remove(block)
for block in bpy.data.materials:
    if block.users == 0:
        bpy.data.materials.remove(block)
for block in bpy.data.curves:
    if block.users == 0:
        bpy.data.curves.remove(block)


# ──────────────────────────────────────────────
# 1.  MATERIALS
# ──────────────────────────────────────────────
def make_mat(name, color, roughness=0.5):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    return mat

# Glassy water blue — semi-transparent
mat_water = make_mat("WaterDrop", (0.15, 0.55, 1.0, 1.0), roughness=0.05)
water_bsdf = mat_water.node_tree.nodes["Principled BSDF"]
water_bsdf.inputs["Transmission Weight"].default_value = 0.7
water_bsdf.inputs["IOR"].default_value = 1.33
water_bsdf.inputs["Specular IOR Level"].default_value = 1.0
mat_water.blend_method = 'BLEND'

# Bright white highlight
mat_highlight = make_mat("DropHighlight", (1.0, 1.0, 1.0, 1.0), roughness=0.0)
hl_bsdf = mat_highlight.node_tree.nodes["Principled BSDF"]
hl_bsdf.inputs["Emission Color"].default_value = (1.0, 1.0, 1.0, 1.0)
hl_bsdf.inputs["Emission Strength"].default_value = 1.5

# Lighter blue for the ripple ring
mat_ripple = make_mat("DropRipple", (0.4, 0.75, 1.0, 1.0), roughness=0.1)
ripple_bsdf = mat_ripple.node_tree.nodes["Principled BSDF"]
ripple_bsdf.inputs["Transmission Weight"].default_value = 0.5


# ──────────────────────────────────────────────
# 2.  HELPERS
# ──────────────────────────────────────────────
def smooth_obj(obj, levels=2):
    bpy.context.view_layer.objects.active = obj
    mod = obj.modifiers.new(name="Subsurf", type='SUBSURF')
    mod.levels = levels
    mod.render_levels = levels + 1
    bpy.ops.object.shade_smooth()

def add_sphere(name, loc, radius, scale, mat, subdiv=2, segs=32, rings=16):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segs, ring_count=rings,
        radius=radius, location=loc
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    obj.data.materials.append(mat)
    smooth_obj(obj, subdiv)
    return obj


# ──────────────────────────────────────────────
# 3.  MAIN DROP BODY — round bottom
# ──────────────────────────────────────────────
body = add_sphere(
    "Drop_Body",
    loc=(0, 0, 0),
    radius=0.3,
    scale=(1.0, 1.0, 1.1),   # slightly taller than wide
    mat=mat_water
)

# ──────────────────────────────────────────────
# 4.  POINTED TOP — the classic teardrop tip
#     A small elongated sphere merged visually with the body
# ──────────────────────────────────────────────
tip = add_sphere(
    "Drop_Tip",
    loc=(0, 0, 0.32),
    radius=0.18,
    scale=(0.55, 0.55, 1.3),  # narrow and tall
    mat=mat_water,
    subdiv=3, segs=24, rings=12
)

# ──────────────────────────────────────────────
# 5.  HIGHLIGHT — white glint on the upper-left
# ──────────────────────────────────────────────
highlight = add_sphere(
    "Drop_Highlight",
    loc=(-0.08, -0.12, 0.15),
    radius=0.06,
    scale=(1.0, 0.7, 0.8),
    mat=mat_highlight,
    subdiv=1, segs=12, rings=6
)

# Second smaller highlight
highlight2 = add_sphere(
    "Drop_Highlight2",
    loc=(-0.04, -0.08, 0.25),
    radius=0.025,
    scale=(1.0, 0.8, 0.8),
    mat=mat_highlight,
    subdiv=1, segs=8, rings=4
)

# ──────────────────────────────────────────────
# 6.  RIPPLE RING — flat torus at the base
# ──────────────────────────────────────────────
bpy.ops.mesh.primitive_torus_add(
    align='WORLD',
    location=(0, 0, -0.22),
    major_radius=0.28,
    minor_radius=0.035,
    major_segments=32,
    minor_segments=8
)
ripple = bpy.context.active_object
ripple.name = "Drop_Ripple"
ripple.scale = (1.0, 1.0, 0.3)   # flatten it into a disc-like ring
bpy.ops.object.transform_apply(scale=True)
ripple.data.materials.append(mat_ripple)
bpy.context.view_layer.objects.active = ripple
bpy.ops.object.shade_smooth()

# ──────────────────────────────────────────────
# 7.  PARENT ALL TO BODY
# ──────────────────────────────────────────────
bpy.ops.object.select_all(action='SELECT')
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.parent_set(type='OBJECT', keep_transform=True)
bpy.ops.object.select_all(action='DESELECT')


# ──────────────────────────────────────────────
# 8.  CAMERA & LIGHTING (preview only)
# ──────────────────────────────────────────────
bpy.ops.object.light_add(type='AREA', location=(1.0, -1.5, 2.0))
key = bpy.context.active_object
key.name = "KeyLight"
key.data.energy = 150
key.data.color = (0.9, 0.95, 1.0)   # cool blue-white for water feel
key.data.size = 3
key.rotation_euler = (math.radians(50), 0, math.radians(40))

bpy.ops.object.light_add(type='AREA', location=(-1.0, -0.5, 1.5))
fill = bpy.context.active_object
fill.name = "FillLight"
fill.data.energy = 60
fill.data.color = (0.8, 0.9, 1.0)
fill.data.size = 4
fill.rotation_euler = (math.radians(55), 0, math.radians(-35))

bpy.ops.object.light_add(type='POINT', location=(0, 1.5, 1.5))
rim = bpy.context.active_object
rim.name = "RimLight"
rim.data.energy = 80
rim.data.color = (0.6, 0.8, 1.0)

bpy.ops.object.camera_add(location=(1.5, -1.5, 1.0))
cam = bpy.context.active_object
cam.name = "BulletCam"
cam.data.lens = 80
bpy.context.scene.camera = cam
constraint = cam.constraints.new(type='TRACK_TO')
constraint.target = body
constraint.track_axis = 'TRACK_NEGATIVE_Z'
constraint.up_axis = 'UP_Y'

# World — soft sky blue
world = bpy.context.scene.world
if world is None:
    world = bpy.data.worlds.new("BulletWorld")
    bpy.context.scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.6, 0.8, 1.0, 1.0)
bg.inputs["Strength"].default_value = 1.2


print("=" * 50)
print("  Water Drop Bullet created!")
print("  Switch to Material Preview to see the drop!")
print("")
print("  To export for the game:")
print("  1. Delete the Camera & Lights first")
print("  2. File → Export → glTF 2.0 (.glb)")
print("  3. Save as bullet.glb in Game/public/")
print("=" * 50)
