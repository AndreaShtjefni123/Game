"""
Popcorn Pickup - Blender 5.x Python Script
===========================================
Scripting tab → Open this file → Run Script (Alt+P)

Creates a small pile of popcorn kernels:
  - 7 puffy, irregular white/cream/yellow kernel shapes
  - Arranged in a loose pile
  - One slightly golden-brown kernel for variety
  - Exports as public/scriptpopcorn.glb
"""

import bpy
import math
import random

random.seed(42)  # fixed seed so the shape is the same every run

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

# ──────────────────────────────────────────────
# 1.  MATERIALS
# ──────────────────────────────────────────────
def make_mat(name, color, roughness=0.8):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    return mat

# Bright white-cream popcorn (most kernels)
mat_white = make_mat("PopcornWhite",  (0.98, 0.95, 0.85, 1.0), roughness=0.85)

# Warm cream/yellow popcorn (buttery tint)
mat_cream = make_mat("PopcornCream",  (0.95, 0.88, 0.65, 1.0), roughness=0.80)

# Golden-brown slightly toasted kernel
mat_brown = make_mat("PopcornBrown",  (0.75, 0.52, 0.22, 1.0), roughness=0.75)

# ──────────────────────────────────────────────
# 2.  KERNEL HELPER
# ──────────────────────────────────────────────
def add_kernel(x, y, z, sx, sy, sz, rot_z, mat):
    """Add one puffy popcorn kernel (squished icosphere) at position."""
    bpy.ops.mesh.primitive_ico_sphere_add(
        subdivisions=3,
        radius=1.0,
        location=(x, y, z)
    )
    obj = bpy.context.active_object
    obj.scale = (sx, sy, sz)
    obj.rotation_euler = (
        random.uniform(0, math.pi),   # random tilt
        random.uniform(0, math.pi),
        rot_z
    )

    # Add a tiny Subdivision Surface for smoothness
    sub = obj.modifiers.new(name="Subsurf", type='SUBSURF')
    sub.levels = 1

    obj.data.materials.append(mat)
    return obj

# ──────────────────────────────────────────────
# 3.  BUILD THE PILE  (7 kernels)
# ──────────────────────────────────────────────
kernels = []

# Bottom layer — 4 kernels spread in a ring
bottom_layer = [
    #  x      y     z     sx    sy    sz    rot_z          mat
    ( 0.30,  0.20, 0.00, 0.55, 0.45, 0.40, 0.3,           mat_white),
    (-0.30,  0.15, 0.00, 0.50, 0.40, 0.38, 1.1,           mat_cream),
    ( 0.05, -0.35, 0.00, 0.52, 0.42, 0.36, 2.0,           mat_white),
    (-0.10,  0.40, 0.00, 0.48, 0.44, 0.35, 0.7,           mat_cream),
]

# Middle layer — 2 kernels sitting on top
middle_layer = [
    ( 0.15,  0.05, 0.30, 0.50, 0.40, 0.38, 0.5,           mat_cream),
    (-0.20,  0.20, 0.28, 0.48, 0.38, 0.35, 1.8,           mat_white),
]

# Top — 1 golden-brown kernel as the crown
top_layer = [
    ( 0.00,  0.10, 0.55, 0.42, 0.35, 0.32, 0.9,           mat_brown),
]

for layer in (bottom_layer, middle_layer, top_layer):
    for (x, y, z, sx, sy, sz, rz, mat) in layer:
        # add a tiny random jitter so it looks natural
        jx = random.uniform(-0.05, 0.05)
        jy = random.uniform(-0.05, 0.05)
        k = add_kernel(x + jx, y + jy, z, sx, sy, sz, rz, mat)
        kernels.append(k)

# ──────────────────────────────────────────────
# 4.  JOIN ALL KERNELS INTO ONE OBJECT
# ──────────────────────────────────────────────
bpy.ops.object.select_all(action='DESELECT')
for k in kernels:
    k.select_set(True)
bpy.context.view_layer.objects.active = kernels[0]
bpy.ops.object.join()

popcorn = bpy.context.active_object
popcorn.name = "Popcorn"

# Centre the origin to the geometry
bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')
popcorn.location = (0, 0, 0)

# ──────────────────────────────────────────────
# 5.  EXPORT AS GLB
# ──────────────────────────────────────────────
import os

# Works whether you opened the .blend from the project root or not
script_dir = os.path.dirname(bpy.data.filepath) or os.getcwd()
out_path = os.path.join(script_dir, "public", "scriptpopcorn.glb")

bpy.ops.export_scene.gltf(
    filepath=out_path,
    export_format='GLB',
    use_selection=True,
    export_apply=True,          # apply modifiers (SubSurf)
    export_animations=False,
)

print(f"✅ Popcorn exported to: {out_path}")
