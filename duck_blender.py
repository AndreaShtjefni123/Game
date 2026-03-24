"""
Cute Duck - Blender 5.x Python Script
======================================
Scripting tab → Open this file → Run Script (Alt+P)

Creates a cute cartoon duck with:
  - Round chubby yellow body
  - Orange beak (flat bill)
  - Big dark eyes with highlights
  - Small wings
  - Orange webbed feet
  - Small tail feathers
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
# 1.  MATERIALS  (Blender 5.x compatible)
# ──────────────────────────────────────────────
def make_mat(name, color, roughness=0.5):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    return mat

# Bright yellow feathers
mat_body = make_mat("DuckFeathers", (1.0, 0.85, 0.1, 1.0), roughness=0.75)

# Lighter yellow for belly
mat_belly = make_mat("DuckBelly", (1.0, 0.92, 0.4, 1.0), roughness=0.8)

# Orange beak & feet
mat_orange = make_mat("DuckOrange", (1.0, 0.55, 0.05, 1.0), roughness=0.4)

# Dark eyes
mat_eye = make_mat("DuckEye", (0.01, 0.01, 0.01, 1.0), roughness=0.05)

# Eye highlight
mat_highlight = make_mat("EyeHighlight", (1.0, 1.0, 1.0, 1.0), roughness=0.0)
hl_bsdf = mat_highlight.node_tree.nodes["Principled BSDF"]
hl_bsdf.inputs["Emission Color"].default_value = (1.0, 1.0, 1.0, 1.0)
hl_bsdf.inputs["Emission Strength"].default_value = 1.0


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
# 3.  BODY  — round chubby yellow ball
# ──────────────────────────────────────────────
body = add_sphere(
    "Duck_Body",
    loc=(0, 0, 0),
    radius=0.55,
    scale=(0.85, 1.0, 0.8),
    mat=mat_body
)

# ──────────────────────────────────────────────
# 4.  BELLY  — lighter patch on the front
# ──────────────────────────────────────────────
belly = add_sphere(
    "Duck_Belly",
    loc=(0, 0.15, -0.12),
    radius=0.42,
    scale=(0.75, 0.85, 0.65),
    mat=mat_belly
)

# ──────────────────────────────────────────────
# 5.  HEAD  — round, sitting on top of body
# ──────────────────────────────────────────────
head = add_sphere(
    "Duck_Head",
    loc=(0, 0.25, 0.6),
    radius=0.38,
    scale=(1.0, 0.95, 1.0),
    mat=mat_body
)

# ──────────────────────────────────────────────
# 6.  BEAK — flat wide bill (top + bottom)
# ──────────────────────────────────────────────

# Top beak
bpy.ops.mesh.primitive_uv_sphere_add(
    segments=24, ring_count=12,
    radius=0.15, location=(0, 0.6, 0.52)
)
beak_top = bpy.context.active_object
beak_top.name = "Duck_BeakTop"
beak_top.scale = (0.75, 1.0, 0.3)
bpy.ops.object.transform_apply(scale=True)
beak_top.data.materials.append(mat_orange)
smooth_obj(beak_top, 2)

# Bottom beak (slightly smaller, below)
bpy.ops.mesh.primitive_uv_sphere_add(
    segments=24, ring_count=12,
    radius=0.12, location=(0, 0.58, 0.46)
)
beak_bot = bpy.context.active_object
beak_bot.name = "Duck_BeakBot"
beak_bot.scale = (0.65, 0.85, 0.2)
bpy.ops.object.transform_apply(scale=True)
beak_bot.data.materials.append(mat_orange)
smooth_obj(beak_bot, 2)

# Nostril dots
for side, xm in [("L", 1), ("R", -1)]:
    add_sphere(
        f"Duck_Nostril_{side}",
        loc=(xm * 0.04, 0.68, 0.55),
        radius=0.012,
        scale=(1, 1, 1),
        mat=mat_eye,
        subdiv=1, segs=8, rings=4
    )

# ──────────────────────────────────────────────
# 7.  EYES — big, cute, on sides of head
# ──────────────────────────────────────────────
eye_y = 0.38
eye_z = 0.7
eye_x = 0.22
eye_radius = 0.1

for side, xm in [("L", 1), ("R", -1)]:
    # Eyeball
    add_sphere(
        f"Duck_Eye_{side}",
        loc=(xm * eye_x, eye_y, eye_z),
        radius=eye_radius,
        scale=(0.8, 0.9, 1.0),
        mat=mat_eye,
        subdiv=2, segs=24, rings=12
    )
    # Highlight
    add_sphere(
        f"Duck_EyeHL_{side}",
        loc=(xm * (eye_x - xm * 0.02), eye_y + 0.05, eye_z + 0.045),
        radius=0.028,
        scale=(1, 1, 1),
        mat=mat_highlight,
        subdiv=1, segs=12, rings=6
    )

# ──────────────────────────────────────────────
# 8.  WINGS — small, on the sides
# ──────────────────────────────────────────────
for side, xm in [("L", 1), ("R", -1)]:
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=16, ring_count=8,
        radius=0.22, location=(xm * 0.48, -0.05, 0.05)
    )
    wing = bpy.context.active_object
    wing.name = f"Duck_Wing_{side}"
    wing.scale = (0.2, 0.8, 0.55)
    wing.rotation_euler = (
        math.radians(-5),
        math.radians(xm * 10),
        math.radians(xm * 15)
    )
    bpy.ops.object.transform_apply(scale=True, rotation=True)
    wing.data.materials.append(mat_body)
    smooth_obj(wing, 2)

# ──────────────────────────────────────────────
# 9.  TAIL FEATHERS — small tuft at the back
# ──────────────────────────────────────────────
tail = add_sphere(
    "Duck_Tail",
    loc=(0, -0.6, 0.15),
    radius=0.14,
    scale=(0.5, 0.6, 0.7),
    mat=mat_body
)

# Little tail tip pointing up
tail_tip = add_sphere(
    "Duck_TailTip",
    loc=(0, -0.7, 0.3),
    radius=0.08,
    scale=(0.35, 0.4, 0.7),
    mat=mat_body,
    subdiv=2, segs=12, rings=6
)

# ──────────────────────────────────────────────
# 10. FEET — orange webbed feet
# ──────────────────────────────────────────────
for side, xm in [("L", 1), ("R", -1)]:
    # Main foot pad
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=16, ring_count=8,
        radius=0.12, location=(xm * 0.2, 0.1, -0.45)
    )
    foot = bpy.context.active_object
    foot.name = f"Duck_Foot_{side}"
    foot.scale = (1.0, 1.3, 0.15)
    bpy.ops.object.transform_apply(scale=True)
    foot.data.materials.append(mat_orange)
    smooth_obj(foot, 2)

    # Three toes (webbed look)
    for t, angle in enumerate([-20, 0, 20]):
        bpy.ops.mesh.primitive_uv_sphere_add(
            segments=12, ring_count=6,
            radius=0.06,
            location=(
                xm * 0.2 + math.sin(math.radians(angle)) * 0.08,
                0.1 + math.cos(math.radians(angle)) * 0.12 + 0.08,
                -0.46
            )
        )
        toe = bpy.context.active_object
        toe.name = f"Duck_Toe_{side}_{t}"
        toe.scale = (0.6, 1.2, 0.12)
        bpy.ops.object.transform_apply(scale=True)
        toe.data.materials.append(mat_orange)
        smooth_obj(toe, 1)


# ──────────────────────────────────────────────
# 11. PARENT ALL TO BODY
# ──────────────────────────────────────────────
bpy.ops.object.select_all(action='SELECT')
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.parent_set(type='OBJECT', keep_transform=True)
bpy.ops.object.select_all(action='DESELECT')


# ──────────────────────────────────────────────
# 12. CAMERA & LIGHTING
# ──────────────────────────────────────────────

# Warm key light
bpy.ops.object.light_add(type='AREA', location=(1.5, -1.5, 2.5))
key = bpy.context.active_object
key.name = "KeyLight"
key.data.energy = 130
key.data.color = (1.0, 0.97, 0.90)
key.data.size = 3
key.rotation_euler = (math.radians(50), 0, math.radians(40))

# Cool fill
bpy.ops.object.light_add(type='AREA', location=(-1.5, -0.5, 1.5))
fill = bpy.context.active_object
fill.name = "FillLight"
fill.data.energy = 50
fill.data.color = (0.9, 0.93, 1.0)
fill.data.size = 4
fill.rotation_euler = (math.radians(55), 0, math.radians(-35))

# Rim light
bpy.ops.object.light_add(type='POINT', location=(0, 1.5, 2))
rim = bpy.context.active_object
rim.name = "RimLight"
rim.data.energy = 60

# Camera
bpy.ops.object.camera_add(location=(2.0, -2.0, 1.5))
cam = bpy.context.active_object
cam.name = "DuckCam"
cam.data.lens = 55
bpy.context.scene.camera = cam
constraint = cam.constraints.new(type='TRACK_TO')
constraint.target = body
constraint.track_axis = 'TRACK_NEGATIVE_Z'
constraint.up_axis = 'UP_Y'


# ──────────────────────────────────────────────
# 13. WORLD — light sky
# ──────────────────────────────────────────────
world = bpy.context.scene.world
if world is None:
    world = bpy.data.worlds.new("DuckWorld")
    bpy.context.scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.7, 0.85, 1.0, 1.0)
bg.inputs["Strength"].default_value = 1.0


print("=" * 50)
print("  ✅  Cute Duck created!")
print("  Switch viewport to Material Preview")
print("  (sphere icon, top-right of 3D viewport)")
print("  to see the yellow duck! 🦆")
print("=" * 50)
