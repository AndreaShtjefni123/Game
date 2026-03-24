"""
Cute Fox - Blender 5.x Python Script
=====================================
Scripting tab → Open this file → Run Script (Alt+P)

Creates a cute cartoon fox NPC with:
  - Orange fur body with white belly/chest
  - Pointy ears with dark tips
  - Big dark cute eyes with highlights
  - White-tipped fluffy tail
  - Small dark nose and cute smile
  - Little paws with dark socks

IMPORTANT: Before exporting as .glb, select only the fox
objects (not camera/lights) or delete the camera & lights first.
File → Export → glTF 2.0 (.glb) → save as fox.glb in public/
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

# Rich orange fur
mat_orange = make_mat("FoxOrange", (0.95, 0.45, 0.08, 1.0), roughness=0.8)

# Darker orange for back/top
mat_dark_orange = make_mat("FoxDarkOrange", (0.85, 0.32, 0.05, 1.0), roughness=0.8)

# White belly / chest / tail tip / muzzle
mat_white = make_mat("FoxWhite", (1.0, 0.97, 0.93, 1.0), roughness=0.85)

# Dark brown/black for nose, ear tips, paw socks, eyes
mat_dark = make_mat("FoxDark", (0.08, 0.05, 0.03, 1.0), roughness=0.4)

# Eye — glossy black
mat_eye = make_mat("FoxEye", (0.01, 0.01, 0.01, 1.0), roughness=0.05)

# Eye highlight
mat_highlight = make_mat("EyeHighlight", (1.0, 1.0, 1.0, 1.0), roughness=0.0)
hl_bsdf = mat_highlight.node_tree.nodes["Principled BSDF"]
hl_bsdf.inputs["Emission Color"].default_value = (1.0, 1.0, 1.0, 1.0)
hl_bsdf.inputs["Emission Strength"].default_value = 1.0

# Pink inner ear
mat_pink = make_mat("FoxPinkEar", (1.0, 0.65, 0.6, 1.0), roughness=0.7)

# Nose — shiny black
mat_nose = make_mat("FoxNose", (0.02, 0.02, 0.02, 1.0), roughness=0.15)


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

def add_cone(name, loc, radius1, radius2, depth, scale, rot, mat, subdiv=2):
    bpy.ops.mesh.primitive_cone_add(
        vertices=24,
        radius1=radius1, radius2=radius2,
        depth=depth, location=loc
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    obj.rotation_euler = rot
    bpy.ops.object.transform_apply(scale=True, rotation=True)
    obj.data.materials.append(mat)
    smooth_obj(obj, subdiv)
    return obj


# ──────────────────────────────────────────────
# 3.  BODY — chubby round orange shape
# ──────────────────────────────────────────────
body = add_sphere(
    "Fox_Body",
    loc=(0, 0, 0),
    radius=0.5,
    scale=(0.8, 1.1, 0.7),
    mat=mat_orange
)

# White belly
belly = add_sphere(
    "Fox_Belly",
    loc=(0, 0.1, -0.1),
    radius=0.38,
    scale=(0.7, 0.9, 0.55),
    mat=mat_white
)

# ──────────────────────────────────────────────
# 4.  HEAD — round, on top/front
# ──────────────────────────────────────────────
head = add_sphere(
    "Fox_Head",
    loc=(0, 0.65, 0.3),
    radius=0.38,
    scale=(1.0, 0.95, 0.95),
    mat=mat_orange
)

# White cheeks / lower face
cheeks = add_sphere(
    "Fox_Cheeks",
    loc=(0, 0.8, 0.2),
    radius=0.25,
    scale=(0.9, 0.7, 0.6),
    mat=mat_white
)

# ──────────────────────────────────────────────
# 5.  SNOUT — small pointed muzzle
# ──────────────────────────────────────────────
snout = add_sphere(
    "Fox_Snout",
    loc=(0, 1.0, 0.18),
    radius=0.15,
    scale=(0.7, 0.9, 0.55),
    mat=mat_white
)

# ──────────────────────────────────────────────
# 6.  NOSE — small shiny black
# ──────────────────────────────────────────────
nose = add_sphere(
    "Fox_Nose",
    loc=(0, 1.1, 0.22),
    radius=0.04,
    scale=(1.2, 0.8, 0.8),
    mat=mat_nose,
    subdiv=2, segs=16, rings=8
)

# ──────────────────────────────────────────────
# 7.  EYES — big, cute, expressive
# ──────────────────────────────────────────────
eye_y = 0.82
eye_z = 0.42
eye_x = 0.18
eye_radius = 0.09

for side, xm in [("L", 1), ("R", -1)]:
    # Eyeball
    add_sphere(
        f"Fox_Eye_{side}",
        loc=(xm * eye_x, eye_y, eye_z),
        radius=eye_radius,
        scale=(0.8, 0.9, 1.0),
        mat=mat_eye,
        subdiv=2, segs=24, rings=12
    )
    # White highlight
    add_sphere(
        f"Fox_EyeHL_{side}",
        loc=(xm * (eye_x - xm * 0.02), eye_y + 0.05, eye_z + 0.045),
        radius=0.025,
        scale=(1, 1, 1),
        mat=mat_highlight,
        subdiv=1, segs=12, rings=6
    )

# ──────────────────────────────────────────────
# 8.  EARS — pointy triangular with dark tips
# ──────────────────────────────────────────────
for side, xm in [("L", 1), ("R", -1)]:
    # Main ear (orange cone)
    ear = add_cone(
        f"Fox_Ear_{side}",
        loc=(xm * 0.2, 0.65, 0.65),
        radius1=0.12, radius2=0.02,
        depth=0.3,
        scale=(0.7, 0.5, 1.0),
        rot=(math.radians(-10), 0, math.radians(xm * 10)),
        mat=mat_orange
    )

    # Dark ear tip
    add_sphere(
        f"Fox_EarTip_{side}",
        loc=(xm * 0.2, 0.65, 0.8),
        radius=0.04,
        scale=(0.8, 0.5, 1.0),
        mat=mat_dark,
        subdiv=1, segs=12, rings=6
    )

    # Pink inner ear
    add_sphere(
        f"Fox_EarInner_{side}",
        loc=(xm * 0.19, 0.67, 0.7),
        radius=0.04,
        scale=(0.5, 0.3, 0.8),
        mat=mat_pink,
        subdiv=1, segs=12, rings=6
    )

# ──────────────────────────────────────────────
# 9.  TAIL — big fluffy with white tip
# ──────────────────────────────────────────────
# Main tail (orange, curves up)
tail_base = add_sphere(
    "Fox_TailBase",
    loc=(0, -0.7, 0.0),
    radius=0.2,
    scale=(0.5, 0.8, 0.5),
    mat=mat_orange
)

tail_mid = add_sphere(
    "Fox_TailMid",
    loc=(0, -0.95, 0.12),
    radius=0.2,
    scale=(0.45, 0.7, 0.5),
    mat=mat_orange
)

tail_end = add_sphere(
    "Fox_TailEnd",
    loc=(0, -1.15, 0.25),
    radius=0.18,
    scale=(0.4, 0.55, 0.45),
    mat=mat_orange
)

# White tail tip
tail_tip = add_sphere(
    "Fox_TailTip",
    loc=(0, -1.3, 0.35),
    radius=0.14,
    scale=(0.4, 0.45, 0.4),
    mat=mat_white
)

# ──────────────────────────────────────────────
# 10.  LEGS / PAWS — small stubby with dark socks
# ──────────────────────────────────────────────
leg_positions = [
    ("FL", 0.22, 0.3, -0.35),   # front left
    ("FR", -0.22, 0.3, -0.35),  # front right
    ("BL", 0.2, -0.35, -0.35),  # back left
    ("BR", -0.2, -0.35, -0.35), # back right
]

for label, lx, ly, lz in leg_positions:
    # Orange upper leg
    add_sphere(
        f"Fox_Leg_{label}",
        loc=(lx, ly, lz),
        radius=0.08,
        scale=(0.8, 0.8, 1.2),
        mat=mat_orange,
        subdiv=2, segs=12, rings=6
    )
    # Dark paw (sock)
    add_sphere(
        f"Fox_Paw_{label}",
        loc=(lx, ly, lz - 0.1),
        radius=0.06,
        scale=(0.9, 1.0, 0.7),
        mat=mat_dark,
        subdiv=1, segs=12, rings=6
    )

# ──────────────────────────────────────────────
# 11.  SMILE — small curve under the nose
# ──────────────────────────────────────────────
curve_data = bpy.data.curves.new(name="FoxSmile", type='CURVE')
curve_data.dimensions = '3D'
curve_data.bevel_depth = 0.008
curve_data.bevel_resolution = 4

spline = curve_data.splines.new('BEZIER')
spline.bezier_points.add(2)

pts = spline.bezier_points
pts[0].co = (-0.06, 1.05, 0.13)
pts[0].handle_left = (-0.08, 1.03, 0.14)
pts[0].handle_right = (-0.04, 1.07, 0.12)

pts[1].co = (0.0, 1.07, 0.11)
pts[1].handle_left = (-0.03, 1.06, 0.11)
pts[1].handle_right = (0.03, 1.06, 0.11)

pts[2].co = (0.06, 1.05, 0.13)
pts[2].handle_left = (0.04, 1.07, 0.12)
pts[2].handle_right = (0.08, 1.03, 0.14)

smile_obj = bpy.data.objects.new("Fox_Smile", curve_data)
bpy.context.collection.objects.link(smile_obj)
smile_obj.data.materials.append(mat_dark)

# ──────────────────────────────────────────────
# 12.  WHISKER DOTS
# ──────────────────────────────────────────────
whisker_spots = [
    (-0.06, 1.04, 0.18), (-0.04, 1.06, 0.16), (-0.08, 1.02, 0.16),
    ( 0.06, 1.04, 0.18), ( 0.04, 1.06, 0.16), ( 0.08, 1.02, 0.16),
]
for i, pos in enumerate(whisker_spots):
    add_sphere(
        f"Fox_Whisker_{i}",
        loc=pos, radius=0.006,
        scale=(1, 1, 1), mat=mat_dark,
        subdiv=1, segs=8, rings=4
    )


# ──────────────────────────────────────────────
# 13.  PARENT ALL TO BODY
# ──────────────────────────────────────────────
bpy.ops.object.select_all(action='SELECT')
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.parent_set(type='OBJECT', keep_transform=True)
bpy.ops.object.select_all(action='DESELECT')


# ──────────────────────────────────────────────
# 14.  CAMERA & LIGHTING (for preview only)
# ──────────────────────────────────────────────
bpy.ops.object.light_add(type='AREA', location=(1.5, -1.5, 2.5))
key = bpy.context.active_object
key.name = "KeyLight"
key.data.energy = 130
key.data.color = (1.0, 0.97, 0.90)
key.data.size = 3
key.rotation_euler = (math.radians(50), 0, math.radians(40))

bpy.ops.object.light_add(type='AREA', location=(-1.5, -0.5, 1.5))
fill = bpy.context.active_object
fill.name = "FillLight"
fill.data.energy = 50
fill.data.color = (0.9, 0.93, 1.0)
fill.data.size = 4
fill.rotation_euler = (math.radians(55), 0, math.radians(-35))

bpy.ops.object.light_add(type='POINT', location=(0, 1.5, 2))
rim = bpy.context.active_object
rim.name = "RimLight"
rim.data.energy = 60

bpy.ops.object.camera_add(location=(2.0, -2.0, 1.5))
cam = bpy.context.active_object
cam.name = "FoxCam"
cam.data.lens = 55
bpy.context.scene.camera = cam
constraint = cam.constraints.new(type='TRACK_TO')
constraint.target = body
constraint.track_axis = 'TRACK_NEGATIVE_Z'
constraint.up_axis = 'UP_Y'

# World
world = bpy.context.scene.world
if world is None:
    world = bpy.data.worlds.new("FoxWorld")
    bpy.context.scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.7, 0.85, 1.0, 1.0)
bg.inputs["Strength"].default_value = 1.0

print("=" * 50)
print("  ✅  Cute Fox created!")
print("  Switch to Material Preview to see colors! 🦊")
print("")
print("  To export for the game:")
print("  1. Delete the Camera & Lights first")
print("  2. File → Export → glTF 2.0 (.glb)")
print("  3. Save as fox.glb in Game/public/")
print("=" * 50)
