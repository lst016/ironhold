"""Render a GLB building into 4 facings with the game's fixed 2:1 isometric camera.

Run: blender -b -P scripts/render_model.py -- assets-src/models/cn/tower.glb assets-src/renders/cn/tower [--fit 1.0] [--tile 80]
Writes <out>_0.png .. <out>_3.png. The model is turned in 90 degree steps; camera and sun stay fixed,
so light falls the same way on every facing (mirroring a sprite flips the light, this does not).

Framing matches the game: a footprint of `fit` cells, `tile` px per cell width (80 = 2x the 40px display tile),
and the cell's front (bottom) vertex sits at the bottom centre of the image, which is where sprites.ts anchors
a building (origin 0.5, 1 on proj(cx + 1, cy + 1)). The empty space above the model is trimmed afterwards by
scripts/compare_render.py, which keeps the bottom edge and the horizontal centre.
"""
import math
import sys

import bpy
import mathutils
from bpy_extras.object_utils import world_to_camera_view

argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
opt = dict(zip(argv[2::2], argv[3::2]))
fit, tile = float(opt.get("--fit", 1.0)), float(opt.get("--tile", 80))

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in sc.objects if o.type == "MESH"]
if not meshes:
    sys.exit("no mesh in " + src)

# Normalise: footprint `fit` cells wide (1 cell = 1 unit), base on z = 0, centred on the origin.
bpy.context.view_layer.update()
pts = [o.matrix_world @ mathutils.Vector(c) for o in meshes for c in o.bound_box]
mn = mathutils.Vector([min(p[i] for p in pts) for i in range(3)])
mx = mathutils.Vector([max(p[i] for p in pts) for i in range(3)])
root = bpy.data.objects.new("root", None)
sc.collection.objects.link(root)
for o in list(sc.objects):
    if o.parent is None and o is not root:
        o.parent = root
k = fit / max(mx.x - mn.x, mx.y - mn.y)
root.scale = (k, k, k)
root.location = (-(mn.x + mx.x) / 2 * k, -(mn.y + mx.y) / 2 * k, -mn.z * k)
height = (mx.z - mn.z) * k

# 2:1 dimetric: 30 degree elevation, 45 degree azimuth, orthographic.
elev, azim = math.radians(30), math.radians(45)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
sc.collection.objects.link(cam)
sc.camera = cam
cam.data.type = "ORTHO"
cam.rotation_euler = (math.pi / 2 - elev, 0, azim)
d = 50
cam.location = (d * math.cos(elev) * math.sin(azim), -d * math.cos(elev) * math.cos(azim), d * math.sin(elev))

# A cell diagonal (sqrt 2 units) is horizontal on screen and must span `tile` px.
half = fit / 2
W = int(math.ceil(tile * max(fit, 1) * 1.6))
H = int(math.ceil(tile * half + height * math.cos(elev) * tile / math.sqrt(2) + tile))
sc.render.resolution_x, sc.render.resolution_y = W, H
cam.data.ortho_scale = max(W, H) * math.sqrt(2) / tile
# Put the front vertex of the footprint at the bottom centre of the frame.
front = mathutils.Vector((half, -half, 0))
for _ in range(3):
    bpy.context.view_layer.update()
    u, v, _z = world_to_camera_view(sc, cam, front)
    cam.data.shift_x += (u - 0.5) * W / max(W, H)
    cam.data.shift_y += v * H / max(W, H)

engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
sc.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in engines else "BLENDER_EEVEE_NEXT"
sc.render.film_transparent = True
sc.view_settings.view_transform = "Standard"
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sc.collection.objects.link(sun)
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(45), 0, math.radians(-15))  # from the upper left of the screen
world = bpy.data.worlds.new("w")
sc.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[1].default_value = 1.0

# Dark outline so the render sits closer to the hand-drawn sprites.
sc.render.use_freestyle = True
sc.render.line_thickness_mode = "ABSOLUTE"
sc.render.line_thickness = 1.5
vl = sc.view_layers[0]
vl.use_freestyle = True
fs = vl.freestyle_settings
ls = fs.linesets[0] if len(fs.linesets) else fs.linesets.new("outline")
ls.select_by_visibility = True
ls.select_silhouette = ls.select_border = ls.select_crease = True
if ls.linestyle is None:
    ls.linestyle = bpy.data.linestyles.new("outline")
ls.linestyle.color = (0.12, 0.07, 0.05)

for i in range(4):
    root.rotation_euler[2] = math.radians(90 * i)
    sc.render.filepath = f"{out}_{i}.png"
    bpy.ops.render.render(write_still=True)
print("RENDERED", W, H, "height", round(height, 3))
