"""Build the application-ready three-axis palletizer asset with Blender 5.2.

The dimensions below are authored in the application's Y-up coordinate system.
PALLETIZER_ROOT is rotated once for Blender's Z-up authoring space; the glTF
exporter converts the hierarchy back to Y-up without changing the runtime node
names used by src/ui/palletizer-3d.js.
"""

import bpy
import math
from mathutils import Vector
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BLEND = ROOT / "assets" / "models" / "automation" / "palletizer-3axis-v2.blend"
GLB = ROOT / "assets" / "models" / "automation" / "palletizer-3axis-v2.glb"
PREVIEW = ROOT / "artifacts" / "palletizer-3axis-v2-preview.png"
BLEND.parent.mkdir(parents=True, exist_ok=True)
PREVIEW.parent.mkdir(parents=True, exist_ok=True)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
    for datablock in tuple(datablocks):
        if datablock.users == 0:
            datablocks.remove(datablock)


def material(name, color, metallic=0.0, roughness=0.45, alpha=1.0, emission=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = (*color, alpha)
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Alpha"].default_value = alpha
    if emission:
        emission_input = bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")
        strength_input = bsdf.inputs.get("Emission Strength")
        if emission_input:
            emission_input.default_value = (*emission, 1.0)
        if strength_input:
            strength_input.default_value = 2.4
    if alpha < 1.0 and hasattr(mat, "surface_render_method"):
        mat.surface_render_method = "DITHERED"
    return mat


ALU = material("Anodized aluminum", (0.43, 0.49, 0.53), 0.78, 0.24)
ALU_DARK = material("Dark anodized aluminum", (0.13, 0.17, 0.19), 0.68, 0.27)
RAIL = material("Linear guide polished", (0.73, 0.78, 0.81), 0.92, 0.12)
STEEL = material("Machined steel", (0.48, 0.53, 0.56), 0.96, 0.13)
BLACK = material("Industrial black", (0.016, 0.022, 0.026), 0.32, 0.43)
FRAME = material("Frame graphite", (0.065, 0.082, 0.091), 0.58, 0.30)
LS_BLUE = material("LS Electric blue", (0.015, 0.31, 0.56), 0.48, 0.25)
SERVO = material("Servo graphite", (0.16, 0.20, 0.22), 0.48, 0.28)
COPPER = material("Connector copper", (0.56, 0.25, 0.06), 0.78, 0.23)
YELLOW = material("Safety yellow", (0.98, 0.60, 0.018), 0.24, 0.34)
RED = material("Emergency red", (0.80, 0.018, 0.012), 0.26, 0.31)
GREEN = material("Start green", (0.015, 0.52, 0.17), 0.18, 0.30)
AMBER = material("Status amber", (1.0, 0.34, 0.01), 0.18, 0.28, emission=(1.0, 0.12, 0.0))
RUBBER = material("Cable and jaw rubber", (0.008, 0.012, 0.014), 0.08, 0.56)
WOOD = material("Pallet hardwood", (0.52, 0.27, 0.075), 0.04, 0.66)
BOX_MAT = material("Training workpiece", (0.77, 0.47, 0.16), 0.05, 0.58)
GLASS = material("Safety polycarbonate", (0.05, 0.38, 0.55), 0.08, 0.20, alpha=0.12)
SCREEN = material("HMI screen", (0.015, 0.075, 0.105), 0.12, 0.22, emission=(0.01, 0.16, 0.26))
WHITE = material("Industrial label white", (0.82, 0.86, 0.86), 0.08, 0.42)
SENSOR_RED = material("Optical sensor lens", (0.72, 0.008, 0.006), 0.12, 0.22, emission=(0.72, 0.008, 0.006))
VACUUM_BLUE = material("Pneumatic vacuum blue", (0.015, 0.22, 0.48), 0.44, 0.28)

BOX_DATA = {}
CYL_DATA = {}


def empty(name, parent=None, loc=(0, 0, 0)):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.16
    obj.location = loc
    bpy.context.collection.objects.link(obj)
    if parent:
        obj.parent = parent
    return obj


def _linked_mesh(name, cache, key, create_data):
    if key in cache:
        obj = bpy.data.objects.new(name, cache[key])
        bpy.context.collection.objects.link(obj)
        return obj
    obj = create_data()
    obj.name = name
    cache[key] = obj.data
    return obj


def box(name, size, loc, mat, parent=None, bevel=0.025, rotation=(0, 0, 0)):
    rounded_size = tuple(round(float(v), 5) for v in size)
    key = (rounded_size, mat.name, round(float(bevel), 5))

    def create_data():
        bpy.ops.mesh.primitive_cube_add(location=(0, 0, 0))
        obj = bpy.context.object
        obj.dimensions = size
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        if bevel:
            modifier = obj.modifiers.new("Edge chamfer", "BEVEL")
            modifier.width = min(bevel, min(size) * 0.22)
            modifier.segments = 2
            modifier.limit_method = "ANGLE"
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        obj.data.materials.append(mat)
        return obj

    obj = _linked_mesh(name, BOX_DATA, key, create_data)
    obj.location = loc
    obj.rotation_euler = rotation
    if parent:
        obj.parent = parent
    return obj


def cylinder(name, radius, depth, loc, mat, parent=None, axis="Y", vertices=20, bevel=0.012):
    key = (round(radius, 5), round(depth, 5), mat.name, vertices, round(bevel, 5))

    def create_data():
        bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=(0, 0, 0))
        obj = bpy.context.object
        if bevel:
            modifier = obj.modifiers.new("Edge chamfer", "BEVEL")
            modifier.width = min(bevel, radius * 0.18, depth * 0.12)
            modifier.segments = 2
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        obj.data.materials.append(mat)
        return obj

    obj = _linked_mesh(name, CYL_DATA, key, create_data)
    obj.location = loc
    if axis == "Y":
        obj.rotation_euler[0] = math.pi / 2
    elif axis == "X":
        obj.rotation_euler[1] = math.pi / 2
    if parent:
        obj.parent = parent
    return obj


def tube(name, points, radius, mat, parent=None, resolution=1):
    curve = bpy.data.curves.new(name + "_Curve", "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = resolution
    curve.bevel_depth = radius
    curve.bevel_resolution = 2
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, co in zip(spline.points, points):
        point.co = (*co, 1.0)
    obj = bpy.data.objects.new(name, curve)
    curve.materials.append(mat)
    bpy.context.collection.objects.link(obj)
    if parent:
        obj.parent = parent
    return obj


def extrusion(name, size, loc, parent=None):
    group = empty(name, parent, loc)
    box(name + "_Body", size, (0, 0, 0), ALU, group, 0.022)
    axis = max(range(3), key=lambda index: size[index])
    groove = 0.022
    if axis == 0:
        for y in (-size[1] * 0.40, size[1] * 0.40):
            for z in (-size[2] * 0.40, size[2] * 0.40):
                box(name + "_TSlot", (size[0] * 0.965, groove, groove), (0, y, z), BLACK, group, 0.003)
    elif axis == 1:
        for x in (-size[0] * 0.40, size[0] * 0.40):
            for z in (-size[2] * 0.40, size[2] * 0.40):
                box(name + "_TSlot", (groove, size[1] * 0.965, groove), (x, 0, z), BLACK, group, 0.003)
    else:
        for x in (-size[0] * 0.40, size[0] * 0.40):
            for y in (-size[1] * 0.40, size[1] * 0.40):
                box(name + "_TSlot", (groove, groove, size[2] * 0.965), (x, y, 0), BLACK, group, 0.003)
    return group


def servo(name, loc, parent=None, axis="X"):
    group = empty(name, parent, loc)
    group["component"] = "AC servo motor"
    box(name + "_Body", (0.62, 0.62, 0.67), (0, 0, -0.03), SERVO, group, 0.055)
    box(name + "_Flange", (0.76, 0.76, 0.13), (0, 0, 0.34), ALU_DARK, group, 0.035)
    box(name + "_RearCap", (0.55, 0.55, 0.16), (0, 0, -0.44), LS_BLUE, group, 0.035)
    box(name + "_Nameplate", (0.39, 0.018, 0.20), (0, -0.322, 0.02), LS_BLUE, group, 0.006)
    for z in (-0.24, -0.12, 0.0, 0.12, 0.24):
        box(name + "_CoolingFin", (0.69, 0.035, 0.025), (0, 0.322, z), ALU_DARK, group, 0.004)
    for x in (-0.23, 0.23):
        for y in (-0.23, 0.23):
            cylinder(name + "_FlangeBolt", 0.035, 0.035, (x, y, 0.415), STEEL, group, "Z", 12, 0.004)
    box(name + "_PowerConnector", (0.25, 0.22, 0.18), (0.16, 0.30, -0.36), BLACK, group, 0.022)
    box(name + "_EncoderConnector", (0.20, 0.18, 0.16), (-0.18, 0.30, -0.36), BLACK, group, 0.020)
    cylinder(name + "_PowerGland", 0.055, 0.10, (0.16, 0.43, -0.36), COPPER, group, "Y", 16, 0.006)
    cylinder(name + "_EncoderGland", 0.045, 0.10, (-0.18, 0.43, -0.36), COPPER, group, "Y", 16, 0.006)
    cylinder(name + "_Shaft", 0.105, 0.34, (0, 0, 0.57), STEEL, group, "Z", 24, 0.008)
    if axis == "X":
        group.rotation_euler[1] = math.pi / 2
    elif axis == "Y":
        group.rotation_euler[0] = math.pi / 2
    return group


def bearing_support(name, loc, parent, axis="X"):
    group = empty(name, parent, loc)
    box(name + "_Block", (0.32, 0.43, 0.43), (0, 0, 0), ALU_DARK, group, 0.035)
    cylinder(name + "_Bearing", 0.125, 0.34, (0, 0, 0), STEEL, group, axis, 24, 0.008)
    return group


def helix(name, center, axis, length, radius, turns, parent):
    points = []
    steps = max(36, turns * 12)
    for index in range(steps + 1):
        t = index / steps
        angle = t * turns * math.tau
        longitudinal = -length / 2 + length * t
        if axis == "X":
            points.append((center[0] + longitudinal, center[1] + math.cos(angle) * radius, center[2] + math.sin(angle) * radius))
        elif axis == "Y":
            points.append((center[0] + math.cos(angle) * radius, center[1] + longitudinal, center[2] + math.sin(angle) * radius))
        else:
            points.append((center[0] + math.cos(angle) * radius, center[1] + math.sin(angle) * radius, center[2] + longitudinal))
    return tube(name, points, 0.009, STEEL, parent)


def sample_polyline(points, count):
    lengths = [(Vector(points[index + 1]) - Vector(points[index])).length for index in range(len(points) - 1)]
    total = sum(lengths)
    result = []
    for index in range(count):
        target = total * index / max(1, count - 1)
        walked = 0.0
        for segment, length in enumerate(lengths):
            if target <= walked + length or segment == len(lengths) - 1:
                amount = 0.0 if length == 0 else (target - walked) / length
                start, end = Vector(points[segment]), Vector(points[segment + 1])
                result.append((start.lerp(end, amount), (end - start).normalized()))
                break
            walked += length
    return result


def energy_chain(name, points, count, parent=None):
    group = empty(name, parent)
    group["component"] = "openable energy chain"
    for index, (position, direction) in enumerate(sample_polyline(points, count)):
        link = empty(f"{name}_Link_{index:02}", group, tuple(position))
        if abs(direction.y) > abs(direction.x) and abs(direction.y) >= abs(direction.z):
            link.rotation_euler[2] = math.copysign(math.pi / 2, direction.y)
        elif abs(direction.z) > abs(direction.x):
            link.rotation_euler[1] = math.copysign(-math.pi / 2, direction.z)
        box(f"{name}_SideA_{index:02}", (0.23, 0.095, 0.055), (0, 0, -0.075), RUBBER, link, 0.014)
        box(f"{name}_SideB_{index:02}", (0.23, 0.095, 0.055), (0, 0, 0.075), RUBBER, link, 0.014)
        box(f"{name}_Crossbar_{index:02}", (0.052, 0.095, 0.19), (0, 0, 0), BLACK, link, 0.010)
        cylinder(f"{name}_Hinge_{index:02}", 0.027, 0.205, (0, 0, 0), ALU_DARK, link, "Z", 12, 0.003)
    return group


def sensor(name, loc, parent, rotation=(0, 0, 0)):
    group = empty(name, parent, loc)
    group.rotation_euler = rotation
    box(name + "_Bracket", (0.14, 0.20, 0.10), (0, 0, 0), ALU_DARK, group, 0.012)
    box(name + "_Body", (0.095, 0.16, 0.13), (0.02, 0.03, 0.08), LS_BLUE, group, 0.014)
    cylinder(name + "_LED", 0.018, 0.012, (0.02, -0.055, 0.148), AMBER, group, "Z", 12, 0.002)
    return group


def fastener(name, loc, parent, axis="Y", radius=0.032):
    """Visible socket-head fastener used only where it improves scale reading."""
    group = empty(name, parent, loc)
    cylinder(name + "_Head", radius, radius * 0.58, (0, 0, 0), STEEL, group, axis, 12, 0.003)
    cylinder(name + "_Socket", radius * 0.40, radius * 0.61, (0, 0, 0), BLACK, group, axis, 8, 0.001)
    return group


def corner_bracket(name, loc, parent, rotation=(0, 0, 0)):
    group = empty(name, parent, loc)
    group.rotation_euler = rotation
    box(name + "_Vertical", (0.32, 0.40, 0.055), (0, 0.15, 0), ALU_DARK, group, 0.018)
    box(name + "_Horizontal", (0.32, 0.055, 0.40), (0, -0.02, 0.15), ALU_DARK, group, 0.018)
    fastener(name + "_BoltA", (-0.09, 0.20, -0.031), group, "Z", 0.028)
    fastener(name + "_BoltB", (0.09, 0.20, -0.031), group, "Z", 0.028)
    fastener(name + "_BoltC", (-0.09, -0.051, 0.20), group, "Y", 0.028)
    fastener(name + "_BoltD", (0.09, -0.051, 0.20), group, "Y", 0.028)
    return group


def vacuum_cup(name, loc, parent):
    group = empty(name, parent, loc)
    cylinder(name + "_Stem", 0.035, 0.18, (0, 0.06, 0), STEEL, group, "Y", 16, 0.004)
    cylinder(name + "_Bellows", 0.075, 0.12, (0, -0.07, 0), RUBBER, group, "Y", 20, 0.008)
    cylinder(name + "_Lip", 0.115, 0.045, (0, -0.145, 0), RUBBER, group, "Y", 24, 0.006)
    cylinder(name + "_Port", 0.025, 0.08, (0.07, 0.055, 0), COPPER, group, "X", 12, 0.003)
    return group


# Export hierarchy. The six named moving groups below are a public runtime API.
root = empty("PALLETIZER_ROOT")
root["asset"] = "Three-axis Cartesian palletizer training cell"
root["coordinateSystem"] = "application Y-up"
root["version"] = "2.1"
static = empty("STATIC_STRUCTURE", root)

# Rigid base, machine bed, leveling feet and extrusion gantry.
box("Machine_Base", (10.9, 0.32, 6.7), (0, 0.30, 0), FRAME, static, 0.075)
box("Machine_Bed", (10.45, 0.085, 6.24), (0, 0.505, 0), ALU_DARK, static, 0.025)
for x in (-5.0, 5.0):
    for z in (-2.90, 2.90):
        extrusion(f"Foot_{x}_{z}", (0.42, 1.05, 0.42), (x, -0.28, z), static)
        cylinder(f"LevelPad_{x}_{z}", 0.28, 0.10, (x, -0.84, z), BLACK, static, "Y", 20, 0.012)
for x in (-5.0, 5.0):
    extrusion(f"Column_{x}", (0.47, 5.05, 0.47), (x, 2.75, 2.72), static)
    box(f"Column_Gusset_{x}", (0.82, 0.56, 0.12), (x, 4.73, 2.42), ALU_DARK, static, 0.025)
    corner_bracket(f"Column_BaseBracket_{x}", (x, 0.62, 2.44), static)
    box(f"Column_EndCap_{x}", (0.49, 0.10, 0.49), (x, 5.30, 2.72), BLACK, static, 0.018)
extrusion("X_Beam", (10.45, 0.58, 0.64), (0, 5.13, 2.72), static)
for x in (-5.25, 5.25):
    box(f"X_Beam_EndCap_{x}", (0.075, 0.56, 0.62), (x, 5.13, 2.72), BLACK, static, 0.015)
box("X_Axis_Nameplate", (1.42, 0.025, 0.24), (3.15, 4.83, 2.89), WHITE, static, 0.010)
box("X_Axis_Nameplate_Stripe", (1.20, 0.012, 0.055), (3.15, 4.81, 2.83), LS_BLUE, static, 0.004)
box("X_Rail_Mounting_Face", (9.92, 0.52, 0.08), (0, 4.88, 2.39), ALU_DARK, static, 0.018)
for rail_index, y in enumerate((4.72, 4.91), 1):
    box(f"X_LinearRail_{rail_index}", (9.80, 0.085, 0.14), (0, y, 2.34), RAIL, static, 0.012)
    for index, x in enumerate((-4.45, -3.50, -2.55, -1.60, -0.65, 0.30, 1.25, 2.20, 3.15, 4.10)):
        cylinder(f"X_RailBolt_{rail_index}_{index:02}", 0.026, 0.018, (x, y - 0.052, 2.34), STEEL, static, "Y", 12, 0.002)
box("X_BallScrew_Cover", (9.78, 0.15, 0.17), (0, 5.03, 2.20), BLACK, static, 0.018)
cylinder("X_BallScrew", 0.052, 9.34, (0, 4.96, 2.25), STEEL, static, "X", 20, 0.006)
helix("X_BallScrew_Thread", (0, 4.96, 2.25), "X", 9.30, 0.058, 32, static)
servo("X_Servo", (-5.37, 5.14, 2.72), static, "X")
cylinder("X_Coupling", 0.14, 0.36, (-4.82, 5.14, 2.72), LS_BLUE, static, "X", 24, 0.010)
bearing_support("X_Fixed_Bearing", (-4.56, 4.96, 2.25), static, "X")
bearing_support("X_Floating_Bearing", (4.56, 4.96, 2.25), static, "X")
energy_chain("X_EnergyChain", [(-4.15, 5.58, 2.12), (-3.70, 5.58, 2.12), (-3.30, 5.30, 2.12), (3.15, 5.30, 2.12), (3.60, 5.58, 2.12)], 20, static)
sensor("X_Home_Sensor", (-4.57, 4.64, 2.17), static)
sensor("X_Positive_Limit", (4.57, 4.64, 2.17), static, (0, math.pi, 0))

# X carriage carries the complete Y bridge and its transmission.
xcar = empty("X_Carriage", root)
xcar["axis"] = "X"
xcar["travelMm"] = 600
box("X_CarriagePlate", (1.06, 0.78, 1.08), (0, 4.82, 2.58), LS_BLUE, xcar, 0.060)
for x in (-0.28, 0.28):
    for y in (4.70, 4.92):
        box("X_RailBlock", (0.30, 0.18, 0.36), (x, y, 2.34), STEEL, xcar, 0.022)
        box("X_RailBlock_Wiper", (0.33, 0.035, 0.39), (x, y - 0.105, 2.34), RUBBER, xcar, 0.010)
for x in (-0.43, 0.43):
    for y in (4.52, 5.12):
        fastener("X_Carriage_Fastener", (x, y, 2.83), xcar, "Z", 0.034)
box("X_BallNut_Housing", (0.42, 0.33, 0.38), (0, 4.96, 2.25), ALU_DARK, xcar, 0.032)
extrusion("Y_Beam", (0.52, 0.54, 5.86), (0, 4.62, 0), xcar)
box("Y_Rail_Mounting_Face", (0.48, 0.12, 5.50), (0, 4.30, 0), ALU_DARK, xcar, 0.016)
for rail_index, x in enumerate((-0.18, 0.18), 1):
    box(f"Y_LinearRail_{rail_index}", (0.095, 0.13, 5.45), (x, 4.25, 0), RAIL, xcar, 0.012)
    for index, z in enumerate((-2.36, -1.57, -0.79, 0, 0.79, 1.57, 2.36)):
        cylinder(f"Y_RailBolt_{rail_index}_{index:02}", 0.023, 0.016, (x, 4.17, z), STEEL, xcar, "Y", 12, 0.002)
cylinder("Y_BallScrew", 0.050, 5.22, (0, 4.34, 0), STEEL, xcar, "Z", 20, 0.006)
helix("Y_BallScrew_Thread", (0, 4.34, 0), "Z", 5.18, 0.056, 22, xcar)
servo("Y_Servo", (0, 4.64, 3.18), xcar, "Y")
cylinder("Y_Coupling", 0.13, 0.30, (0, 4.40, 2.67), LS_BLUE, xcar, "Z", 22, 0.010)
bearing_support("Y_Fixed_Bearing", (0, 4.34, 2.54), xcar, "Z")
bearing_support("Y_Floating_Bearing", (0, 4.34, -2.54), xcar, "Z")
energy_chain("Y_EnergyChain", [(0.41, 4.75, 2.30), (0.41, 4.75, 1.95), (0.41, 4.48, 1.62), (0.41, 4.48, -2.14)], 15, xcar)
sensor("Y_Home_Sensor", (-0.31, 4.16, 2.42), xcar)
sensor("Y_Positive_Limit", (-0.31, 4.16, -2.42), xcar, (0, math.pi, 0))

# Y carriage supports the vertical Z axis.
ycar = empty("Y_Carriage", xcar)
ycar["axis"] = "Y"
ycar["travelMm"] = 420
box("Y_CarriagePlate", (1.02, 0.66, 1.04), (0, 4.28, 0), LS_BLUE, ycar, 0.058)
for x in (-0.25, 0.25):
    for z in (-0.27, 0.27):
        box("Y_RailBlock", (0.26, 0.18, 0.30), (x, 4.18, z), STEEL, ycar, 0.020)
        box("Y_RailBlock_Wiper", (0.29, 0.035, 0.33), (x, 4.075, z), RUBBER, ycar, 0.009)
box("Y_BallNut_Housing", (0.40, 0.30, 0.42), (0, 4.34, 0), ALU_DARK, ycar, 0.030)
zframe = empty("Z_Mast", ycar)
box("Z_Mast_Backplate", (0.62, 4.42, 0.14), (0, 2.31, -0.18), ALU_DARK, zframe, 0.025)
for x in (-0.31, 0.31):
    extrusion("Z_Mast_SideRail", (0.14, 4.42, 0.52), (x, 2.31, 0), zframe)
for y in (0.12, 2.31, 4.50):
    box("Z_Mast_CrossBrace", (0.66, 0.16, 0.54), (0, y, 0), ALU_DARK, zframe, 0.020)
box("Z_Rail_Mounting_Face", (0.48, 4.04, 0.12), (0, 2.31, 0.28), ALU_DARK, ycar, 0.016)
for rail_index, x in enumerate((-0.18, 0.18), 1):
    box(f"Z_LinearRail_{rail_index}", (0.085, 4.00, 0.13), (x, 2.31, 0.35), RAIL, ycar, 0.012)
    for index, y in enumerate((0.53, 1.13, 1.73, 2.33, 2.93, 3.53, 4.08)):
        cylinder(f"Z_RailBolt_{rail_index}_{index:02}", 0.022, 0.016, (x, y, 0.43), STEEL, ycar, "Z", 12, 0.002)
cylinder("Z_BallScrew", 0.048, 3.82, (0, 2.35, 0.16), STEEL, ycar, "Y", 20, 0.006)
helix("Z_BallScrew_Thread", (0, 2.35, 0.16), "Y", 3.78, 0.054, 18, ycar)
servo("Z_Servo", (0, 4.18, 0.02), ycar, "Y")
cylinder("Z_Coupling", 0.12, 0.28, (0, 3.70, 0.16), LS_BLUE, ycar, "Y", 22, 0.009)
bearing_support("Z_Fixed_Bearing", (0, 3.55, 0.16), ycar, "Y")
bearing_support("Z_Floating_Bearing", (0, 0.58, 0.16), ycar, "Y")
energy_chain("Z_EnergyChain", [(-0.39, 3.90, -0.24), (-0.39, 3.48, -0.24), (-0.39, 3.15, -0.48), (-0.39, 0.92, -0.48)], 12, ycar)
sensor("Z_Home_Sensor", (0.32, 4.04, 0.30), ycar, (0, 0, math.pi / 2))
sensor("Z_Negative_Limit", (0.32, 0.55, 0.30), ycar, (0, 0, -math.pi / 2))

# Moving Z slide and compact pneumatic parallel gripper.
zslide = empty("Z_Slide", ycar, (0, 0.95, 0))
zslide["axis"] = "Z"
zslide["travelMm"] = 280
box("Z_CarriagePlate", (0.94, 0.72, 0.88), (0, 0, 0), LS_BLUE, zslide, 0.058)
for x in (-0.25, 0.25):
    for y in (-0.22, 0.22):
        box("Z_RailBlock", (0.27, 0.27, 0.28), (x, y, 0.32), STEEL, zslide, 0.020)
for x in (-0.36, 0.36):
    for y in (-0.27, 0.27):
        fastener("Z_Carriage_Fastener", (x, y, -0.46), zslide, "Z", 0.030)
box("Z_BallNut_Housing", (0.38, 0.38, 0.34), (0, 0, 0.16), ALU_DARK, zslide, 0.028)
ram = empty("Z_Telescopic_InnerRam", zslide)
for x in (-0.25, 0.25):
    box("Z_Moving_SideGuide", (0.10, 1.30, 0.18), (x, 0.68, 0.22), RAIL, ram, 0.018)
    box("Z_Moving_GuideWiper", (0.15, 0.12, 0.23), (x, 0.09, 0.22), RUBBER, ram, 0.014)
box("Z_Moving_Crosshead", (0.68, 0.16, 0.42), (0, 1.25, 0.10), ALU_DARK, ram, 0.030)
for index, y in enumerate((0.10, 0.24, 0.38, 0.52, 0.66, 0.80, 0.94, 1.08), 1):
    box(f"Z_Bellows_{index:02}", (0.34, 0.07, 0.10), (0, y, 0.36), RUBBER, zslide, 0.010)
box("Z_EOAT_MountingFlange", (0.70, 0.16, 0.70), (0, 1.25, 0), ALU_DARK, zslide, 0.032)
gripper = empty("Gripper", zslide, (0, 1.35, 0))
gripper["component"] = "vacuum-assisted pneumatic parallel gripper"
cylinder("Gripper_Rotator", 0.23, 0.38, (0, -0.05, 0), SERVO, gripper, "Y", 24, 0.014)
cylinder("Gripper_RotatorRing", 0.26, 0.08, (0, -0.26, 0), LS_BLUE, gripper, "Y", 24, 0.010)
box("Gripper_CrossPlate", (1.02, 0.18, 0.72), (0, -0.33, 0), ALU_DARK, gripper, 0.040)
box("Gripper_ValveBlock", (0.32, 0.22, 0.28), (0.31, -0.47, 0.26), LS_BLUE, gripper, 0.026)
cylinder("Gripper_PneumaticCylinder", 0.13, 0.68, (0, -0.48, 0), ALU, gripper, "X", 20, 0.010)
cylinder("Gripper_PistonRod", 0.045, 0.88, (0, -0.48, 0), STEEL, gripper, "X", 16, 0.005)
box("Gripper_Slide", (0.78, 0.17, 0.48), (0, -0.61, 0), LS_BLUE, gripper, 0.030)
for x in (-0.28, 0.28):
    box("Jaw_Guide", (0.17, 0.12, 0.40), (x, -0.72, 0), RAIL, gripper, 0.016)
tube("Gripper_Air_Blue", [(0.31, -0.43, 0.31), (0.50, -0.52, 0.32), (0.42, -0.67, 0.18)], 0.018, LS_BLUE, gripper)
tube("Gripper_Air_Yellow", [(0.31, -0.43, 0.21), (0.51, -0.54, 0.15), (0.40, -0.67, -0.10)], 0.018, YELLOW, gripper)
box("Vacuum_Manifold", (0.74, 0.16, 0.46), (0, -0.82, 0), VACUUM_BLUE, gripper, 0.028)
box("Vacuum_Ejector", (0.22, 0.30, 0.20), (0.42, -0.84, 0.24), BLACK, gripper, 0.024)
box("Vacuum_PressureSwitch", (0.19, 0.22, 0.16), (-0.42, -0.84, 0.24), BLACK, gripper, 0.020)
cylinder("Vacuum_Pressure_LED", 0.027, 0.018, (-0.42, -0.965, 0.29), SENSOR_RED, gripper, "Y", 16, 0.003)
for index, (x, z) in enumerate(((-0.31, -0.22), (-0.31, 0.22), (0.31, -0.22), (0.31, 0.22))):
    vacuum_cup(f"Vacuum_Cup_{index + 1}", (x, -1.16, z), gripper)
    tube(f"Vacuum_Hose_{index + 1}", [(0, -0.84, 0), (x * 0.65, -0.97, z * 0.65), (x, -1.08, z)], 0.014, VACUUM_BLUE, gripper)
jawl = empty("Jaw_L", gripper, (-0.43, 0, 0))
jawr = empty("Jaw_R", gripper, (0.43, 0, 0))
jawl["openX"], jawl["closedX"] = -0.43, -0.39
jawr["openX"], jawr["closedX"] = 0.43, 0.39
for prefix, jaw, side in (("Jaw_L", jawl, 1), ("Jaw_R", jawr, -1)):
    box(prefix + "_Carrier", (0.22, 0.25, 0.42), (0, -0.76, 0), STEEL, jaw, 0.022)
    box(prefix + "_Finger", (0.14, 0.70, 0.22), (0, -1.05, 0), STEEL, jaw, 0.022)
    box(prefix + "_Pad", (0.19, 0.18, 0.34), (side * 0.035, -1.38, 0), RUBBER, jaw, 0.018)
    for y in (-0.88, -1.17):
        cylinder(prefix + "_Fastener", 0.027, 0.025, (0, y, 0.125), STEEL, jaw, "Z", 12, 0.003)

# Work area: a located pick nest, workpiece and pallet. Runtime workpieces hide
# the authored pallet boards but retain these fixtures for realistic scale.
box("Pick_Fixture", (1.45, 0.17, 1.18), (-3.15, 0.57, -1.70), ALU_DARK, static, 0.038)
for x in (-3.62, -2.68):
    for z in (-2.10, -1.30):
        cylinder("Locator_Pin", 0.065, 0.24, (x, 0.70, z), YELLOW, static, "Y", 16, 0.006)
sensor("Workpiece_PhotoSensor", (-3.83, 0.78, -1.70), static, (0, 0, math.pi / 2))
for index in range(-2, 3):
    box(f"Pallet_Slat_{index}", (2.46, 0.12, 0.34), (2.75, 0.57, -1.45 + index * 0.39), WOOD, static, 0.022)
    for x in (1.72, 2.75, 3.78):
        cylinder("Pallet_Nail", 0.022, 0.012, (x, 0.638, -1.45 + index * 0.39), STEEL, static, "Y", 10, 0.002)
for z in (-2.05, -0.85):
    box("Pallet_Block", (2.28, 0.18, 0.18), (2.75, 0.42, z), WOOD, static, 0.018)
sensor("Pallet_Present_Sensor", (3.95, 0.69, -1.46), static, (0, 0, -math.pi / 2))

# Functional guarding and LS-style operator cabinet; no classroom scenery.
for x, z in ((-5.35, -3.15), (-5.35, 3.15), (5.35, -3.15), (5.35, 3.15)):
    extrusion("Safety_Post", (0.18, 2.75, 0.18), (x, 1.83, z), static)
    box("Safety_Foot", (0.36, 0.10, 0.36), (x, 0.44, z), YELLOW, static, 0.028)
box("Rear_Safety_Guard", (10.52, 2.35, 0.025), (0, 1.83, 3.15), GLASS, static, 0.004)
box("Left_Safety_Guard", (0.025, 2.35, 5.92), (-5.35, 1.83, 0), GLASS, static, 0.004)
box("Right_Safety_Guard", (0.025, 2.35, 2.05), (5.35, 1.83, 1.98), GLASS, static, 0.004)
gate = empty("Front_Safety_Gate", static, (1.75, 0, -3.15))
box("Gate_Polycarbonate", (3.20, 2.35, 0.025), (0, 1.83, 0), GLASS, gate, 0.004)
for x in (-1.62, 1.62):
    extrusion("Gate_Vertical_Frame", (0.13, 2.55, 0.13), (x, 1.78, 0), gate)
for y in (0.53, 3.03):
    extrusion("Gate_Horizontal_Frame", (3.37, 0.13, 0.13), (0, y, 0), gate)
box("Gate_Handle", (0.09, 0.52, 0.12), (1.32, 1.77, -0.10), YELLOW, gate, 0.022)
box("Gate_Interlock", (0.22, 0.42, 0.18), (-1.70, 2.16, 0.10), BLACK, gate, 0.025)
box("Gate_Interlock_Actuator", (0.10, 0.24, 0.08), (-1.55, 2.16, 0.10), STEEL, gate, 0.012)
cab = empty("LS_Control_Cabinet", static, (4.52, 0, -2.50))
box("Cabinet", (1.42, 2.48, 0.82), (0, 1.66, 0), ALU, cab, 0.055)
box("Cabinet_Door", (1.28, 2.27, 0.055), (0, 1.66, 0.438), ALU_DARK, cab, 0.022)
for y in (0.82, 2.50):
    cylinder("Cabinet_Hinge", 0.045, 0.18, (-0.65, y, 0.47), STEEL, cab, "Y", 16, 0.005)
box("Cabinet_Equipment_Label", (0.72, 0.025, 0.20), (0, 2.69, 0.49), WHITE, cab, 0.008)
box("Cabinet_Equipment_Label_Stripe", (0.62, 0.012, 0.045), (0, 2.67, 0.505), LS_BLUE, cab, 0.004)
box("Cabinet_HMI_Bezel", (0.74, 0.48, 0.06), (0, 2.17, 0.485), BLACK, cab, 0.022)
box("Cabinet_HMI_Screen", (0.62, 0.36, 0.025), (0, 2.17, 0.525), SCREEN, cab, 0.010)
box("Cabinet_LS_Stripe", (0.86, 0.07, 0.025), (0, 1.82, 0.482), LS_BLUE, cab, 0.006)
cylinder("Emergency_Stop", 0.115, 0.13, (-0.40, 1.38, 0.52), RED, cab, "Z", 24, 0.010)
cylinder("Start_Button", 0.070, 0.07, (-0.12, 1.38, 0.50), GREEN, cab, "Z", 20, 0.007)
cylinder("Reset_Button", 0.070, 0.07, (0.10, 1.38, 0.50), LS_BLUE, cab, "Z", 20, 0.007)
cylinder("Auto_Key", 0.065, 0.075, (0.34, 1.38, 0.50), STEEL, cab, "Z", 20, 0.007)
box("Cabinet_Handle", (0.07, 0.42, 0.08), (0.52, 1.70, 0.50), BLACK, cab, 0.018)
for index, y in enumerate((0.82, 0.91, 1.00, 1.09, 1.18)):
    box(f"Cabinet_Vent_{index}", (0.55, 0.025, 0.035), (-0.20, y, 0.48), BLACK, cab, 0.005)
for index, (y, lamp_mat) in enumerate(((3.38, RED), (3.18, YELLOW), (2.98, GREEN))):
    cylinder(f"Tower_Lamp_{index}", 0.115, 0.18, (0.43, y, 0), lamp_mat, cab, "Y", 24, 0.006)
cylinder("Tower_Lamp_Pole", 0.048, 0.34, (0.43, 2.76, 0), STEEL, cab, "Y", 16, 0.005)
box("Cable_Tray", (8.45, 0.16, 0.28), (0.20, 0.64, -2.70), BLACK, static, 0.018)
for index, x in enumerate((-3.6, -1.8, 0, 1.8, 3.6)):
    box(f"Cable_Tray_Crossbar_{index}", (0.055, 0.20, 0.36), (x, 0.65, -2.70), ALU_DARK, static, 0.008)

# Rotate the complete exported hierarchy into Blender Z-up. Blender's exporter
# then writes an application-native Y-up hierarchy to the GLB.
root.rotation_euler[0] = math.pi / 2

# Editable .blend authoring helpers are deliberately excluded from the GLB.
preview_target = empty("AUTHORING_Preview_Target", None, (0, 0, 2.35))
bpy.ops.object.camera_add(location=(13.8, -15.8, 10.6))
camera = bpy.context.object
camera.name = "AUTHORING_Preview_Camera"
camera.data.lens = 52
bpy.context.scene.camera = camera
constraint = camera.constraints.new(type="TRACK_TO")
constraint.target = preview_target
constraint.track_axis = "TRACK_NEGATIVE_Z"
constraint.up_axis = "UP_Y"
for index, (loc, energy, size) in enumerate((((-7, -8, 13), 1050, 6), ((9, -5, 8), 780, 5), ((0, 7, 11), 620, 4))):
    bpy.ops.object.light_add(type="AREA", location=loc)
    light = bpy.context.object
    light.name = f"AUTHORING_KeyLight_{index}"
    light.data.energy = energy
    light.data.shape = "DISK"
    light.data.size = size
    track = light.constraints.new(type="TRACK_TO")
    track.target = preview_target
    track.track_axis = "TRACK_NEGATIVE_Z"
    track.up_axis = "UP_Y"

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1280
scene.render.resolution_y = 720
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = str(PREVIEW)
scene.world.color = (0.018, 0.025, 0.032)
scene.view_settings.look = "AgX - Medium High Contrast"

# Validate the runtime contract before writing either artifact.
required = ("PALLETIZER_ROOT", "X_Carriage", "Y_Carriage", "Z_Slide", "Gripper", "Jaw_L", "Jaw_R")
missing = [name for name in required if bpy.data.objects.get(name) is None]
if missing:
    raise RuntimeError(f"Missing runtime nodes: {', '.join(missing)}")
if ycar.parent is not xcar or zslide.parent is not ycar or gripper.parent is not zslide or jawl.parent is not gripper or jawr.parent is not gripper:
    raise RuntimeError("Palletizer moving hierarchy is invalid")

export_meshes = [obj for obj in root.children_recursive if obj.type == "MESH"]
triangles = sum(len(poly.vertices) - 2 for obj in export_meshes for poly in obj.data.polygons)
if triangles > 100_000:
    raise RuntimeError(f"Palletizer triangle budget exceeded: {triangles:,} > 100,000")

bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), check_existing=False)

# Export only PALLETIZER_ROOT and its descendants. Cameras, lights and preview
# targets stay in the .blend but cannot leak into the application asset.
bpy.ops.object.select_all(action="DESELECT")
root.select_set(True)
for obj in root.children_recursive:
    obj.select_set(True)
bpy.context.view_layer.objects.active = root
bpy.ops.export_scene.gltf(
    filepath=str(GLB),
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_yup=True,
    export_cameras=False,
    export_lights=False,
    export_extras=True,
    export_animations=False,
    export_shared_accessors=True,
    # Do not combine GPU instancing with destructive object joins. Repeated
    # details already share Blender Mesh datablocks, and the normal glTF scene
    # representation keeps the output small and compatible with Three r149.
    export_gpu_instances=False,
)
bpy.ops.render.render(write_still=True)

print(
    "PALLETIZER_EXPORT_OK "
    f"blend={BLEND} glb={GLB} objects={len(root.children_recursive) + 1} "
    f"meshes={len(export_meshes)} unique_meshes={len({obj.data.name for obj in export_meshes})} "
    f"triangles={triangles}"
)
