"""Build the manual-backed equipment library with Blender 5.2.

Run this script inside a dedicated, unsaved Blender process.  The script keeps
every source model in ``manual-backed-equipment.blend`` and exports one embedded
GLB per catalog entry.  It deliberately refuses to clear a saved or non-default
scene unless the caller opts in with the ``codex_manual_asset_build`` scene flag.
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Iterable, Sequence

import bpy
from mathutils import Vector


MM = 0.001


MODELS = (
    {
        "file": "xbc-dr32h.glb",
        "model": "XBC-DR32H",
        "dimensions": {"width": 114, "height": 100, "depth": 64},
        "manual": "pdf/02_LS_XGB_Hardware_XBC-DR32H_Manual_EN.pdf",
        "pages": [39, 43, 95, 96, 125, 130, 253],
        "terminals": [
            "L", "N", "PE", "NC", "24V", "24G", "COMI",
            *[f"P0{index:X}" for index in range(16)],
            *[f"P2{index:X}" for index in range(16)],
            "COM0", "COM1", "COM2", "COM3", "RX", "TX", "SG", "485+", "485-",
        ],
        "kind": "plc",
    },
    {
        "file": "mdr-100-24.glb",
        "model": "MDR-100-24",
        "dimensions": {"width": 55, "height": 90, "depth": 100},
        "manual": "pdf/01_MDR-100-24_MeanWell_SPEC.pdf",
        "pages": [1, 2],
        "terminals": ["L", "N", "PE", "V+1", "V+2", "V-1", "V-2", "DCOK-A", "DCOK-B"],
        "kind": "power-supply",
    },
    {
        "file": "mc-22b-dc24.glb",
        "model": "MC-22b DC24V 1a1b",
        "dimensions": {"width": 45, "height": 73.5, "depth": 103.6},
        "manual": "pdf/08_LS_Metasol_MC_Contactor_Catalog.pdf",
        "pages": [10, 18, 22, 75, 125],
        "terminals": ["1L1", "2T1", "3L2", "4T2", "5L3", "6T3", "13", "14", "21", "22", "A1", "A2"],
        "kind": "contactor",
    },
    {
        "file": "my2n-d2-dc24.glb",
        "model": "MY2N-D2 DC24V",
        "dimensions": {"width": 21.5, "height": 36, "depth": 28},
        "manual": "pdf/official/Omron_MY_Series_J219-E1.pdf",
        "pages": [8, 10, 20],
        "terminals": ["1", "5", "9", "4", "8", "12", "13", "14"],
        "kind": "relay",
    },
    {
        "file": "eocr3de-05duh.glb",
        "model": "EOCR3DE-05DUH",
        "dimensions": {"width": 70, "height": 70, "depth": 106},
        "manual": "pdf/official/Schneider_EOCR_Digital_E_Instruction_2023.pdf",
        "pages": [1, 2],
        "terminals": ["L1-IN", "L1-OUT", "L2-IN", "L2-OUT", "L3-IN", "L3-OUT", "A1", "A2", "95", "96", "97", "98", "07", "08"],
        "kind": "overload-relay",
    },
    {
        "file": "ut-2-5-3044076.glb",
        "model": "UT 2,5 / 3044076",
        "dimensions": {"width": 5.2, "height": 47.7, "depth": 46.9},
        "manual": "pdf/official/Phoenix_UT-2.5_3044076.pdf",
        "pages": [1, 2, 3, 4, 7],
        "terminals": ["1", "2"],
        "kind": "terminal-block",
    },
    {
        "file": "ut-2-5-pe-3044092.glb",
        "model": "UT 2,5-PE / 3044092",
        "dimensions": {"width": 5.2, "height": 47.7, "depth": 46.9},
        "manual": "pdf/official/Phoenix_UT-2.5-PE_3044092.pdf",
        "pages": [1, 2, 3, 5],
        "terminals": ["1", "2"],
        "kind": "pe-terminal-block",
    },
    {
        "file": "ut-4-hesi-3046032.glb",
        "model": "UT 4-HESI (5X20) / 3046032",
        "dimensions": {"width": 6.2, "height": 57.8, "depth": 75.6},
        "manual": "pdf/official/Phoenix_UT-4-HESI-5x20_3046032.pdf",
        "pages": [1, 2, 3, 8],
        "terminals": ["1", "2"],
        "kind": "fused-terminal-block",
    },
)


PALETTE = {
    "dark": (0.045, 0.055, 0.07, 1.0),
    "black": (0.012, 0.014, 0.018, 1.0),
    "gray": (0.25, 0.28, 0.31, 1.0),
    "light-gray": (0.64, 0.67, 0.69, 1.0),
    "white": (0.82, 0.83, 0.80, 1.0),
    "ivory": (0.76, 0.77, 0.73, 1.0),
    "panel": (0.67, 0.69, 0.68, 1.0),
    "cream": (0.83, 0.82, 0.76, 1.0),
    "silver": (0.52, 0.55, 0.57, 1.0),
    "blue": (0.08, 0.28, 0.58, 1.0),
    "blue-shell": (0.18, 0.39, 0.49, 1.0),
    "pcb-green": (0.08, 0.27, 0.13, 1.0),
    "clear": (0.54, 0.72, 0.86, 0.20),
    "coil-cream": (0.82, 0.78, 0.65, 1.0),
    "green": (0.06, 0.50, 0.22, 1.0),
    "led-green": (0.08, 0.78, 0.18, 1.0),
    "led-cyan": (0.28, 0.86, 1.0, 1.0),
    "led-red": (0.92, 0.025, 0.018, 1.0),
    "led-amber": (1.0, 0.40, 0.015, 1.0),
    "orange": (0.92, 0.30, 0.035, 1.0),
    "yellow": (1.0, 0.70, 0.03, 1.0),
    "red": (0.78, 0.035, 0.025, 1.0),
    "terminal": (0.46, 0.49, 0.52, 1.0),
    "copper": (0.55, 0.22, 0.055, 1.0),
    "ral7042": (0.43, 0.45, 0.44, 1.0),
    "pe-yellow": (0.90, 0.82, 0.025, 1.0),
    "pe-green": (0.015, 0.36, 0.075, 1.0),
}


def repo_root() -> Path:
    script_file = globals().get("__file__")
    candidates = []
    if script_file:
        candidates.append(Path(script_file).resolve().parent.parent)
    candidates.extend((Path.cwd(), Path(bpy.path.abspath("//"))))
    for candidate in candidates:
        for parent in (candidate, *candidate.parents):
            if (parent / "package.json").exists() and (parent / "pdf").is_dir():
                return parent
    raise RuntimeError("Unable to locate plc-wiring-trainer repository root")


def assert_safe_scene() -> None:
    scene = bpy.context.scene
    if scene.get("codex_manual_asset_build"):
        return
    default_objects = {"Cube", "Camera", "Light"}
    unexpected = [obj.name for obj in bpy.data.objects if obj.name not in default_objects]
    if bpy.data.filepath or unexpected:
        raise RuntimeError(
            "Refusing to clear a saved or non-default Blender scene. "
            "Use a dedicated process and set scene['codex_manual_asset_build'] = True."
        )


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in tuple(bpy.data.collections):
        bpy.data.collections.remove(collection)


def material(name: str):
    color = PALETTE[name]
    value = bpy.data.materials.get(f"manual:{name}") or bpy.data.materials.new(f"manual:{name}")
    value.diffuse_color = color
    value.use_nodes = True
    shader = value.node_tree.nodes.get("Principled BSDF")
    if shader:
        shader.inputs["Base Color"].default_value = color
        shader.inputs["Alpha"].default_value = color[3]
        shader.inputs["Roughness"].default_value = 0.48
        shader.inputs["Metallic"].default_value = 0.0
        if name in {"terminal", "copper", "silver"}:
            shader.inputs["Metallic"].default_value = 0.58
        if name == "yellow" or name.startswith("led-"):
            shader.inputs["Emission Color"].default_value = color
            shader.inputs["Emission Strength"].default_value = 0.55
        else:
            shader.inputs["Emission Color"].default_value = (0, 0, 0, 1)
            shader.inputs["Emission Strength"].default_value = 0.0
    if hasattr(value, "surface_render_method"):
        value.surface_render_method = "BLENDED" if color[3] < 1 else "DITHERED"
        if hasattr(value, "use_transparency_overlap"):
            value.use_transparency_overlap = color[3] < 1
    elif hasattr(value, "blend_method"):
        value.blend_method = "BLEND" if color[3] < 1 else "OPAQUE"
    return value


def link_object(obj, collection) -> None:
    for current in tuple(obj.users_collection):
        current.objects.unlink(obj)
    collection.objects.link(obj)


def box(name: str, size_mm: Sequence[float], location_mm: Sequence[float], mat: str, parent, collection, bevel_mm: float = 0.6):
    bpy.ops.mesh.primitive_cube_add(size=1, location=tuple(value * MM for value in location_mm))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = tuple(max(value, 0.05) * MM for value in size_mm)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material(mat))
    obj.parent = parent
    link_object(obj, collection)
    if bevel_mm > 0:
        modifier = obj.modifiers.new("edge-softening", "BEVEL")
        modifier.width = min(bevel_mm * MM, min(obj.dimensions) * 0.24)
        modifier.segments = 2
    return obj


def cylinder(name: str, radius_mm: float, depth_mm: float, location_mm: Sequence[float], mat: str, parent, collection, axis: str = "Y"):
    rotation = (math.pi / 2, 0, 0) if axis == "Y" else (0, math.pi / 2, 0) if axis == "X" else (0, 0, 0)
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=20,
        radius=radius_mm * MM,
        depth=depth_mm * MM,
        end_fill_type="NGON",
        location=tuple(value * MM for value in location_mm),
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material(mat))
    obj.parent = parent
    link_object(obj, collection)
    return obj


def side_prism(name: str, width_mm: float, yz_points: Sequence[Sequence[float]], mat: str, parent, collection, bevel_mm: float = 0.18):
    """Extrude a terminal-block side profile across its narrow stacking width."""
    if len(yz_points) < 3:
        raise ValueError(f"{name} needs at least three side-profile points")
    half_width = width_mm * MM / 2
    vertices = [(-half_width, y * MM, z * MM) for y, z in yz_points]
    vertices.extend((half_width, y * MM, z * MM) for y, z in yz_points)
    count = len(yz_points)
    faces = [tuple(range(count - 1, -1, -1)), tuple(range(count, count * 2))]
    for index in range(count):
        next_index = (index + 1) % count
        faces.append((index, next_index, count + next_index, count + index))
    mesh = bpy.data.meshes.new(f"mesh:{name}")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.parent = parent
    obj.data.materials.append(material(mat))
    if bevel_mm > 0:
        modifier = obj.modifiers.new("edge-softening", "BEVEL")
        modifier.width = min(bevel_mm * MM, width_mm * MM * 0.16)
        modifier.segments = 2
    return obj


def empty_node(name: str, location_mm: Sequence[float], parent, collection):
    obj = bpy.data.objects.new(name, None)
    collection.objects.link(obj)
    obj.parent = parent
    obj.location = tuple(value * MM for value in location_mm)
    obj.empty_display_type = "CIRCLE"
    obj.empty_display_size = 2.5 * MM
    return obj


def terminal_entry(name: str, end_y_mm: float, z_mm: float, radius_mm: float, root, collection):
    """Make a Y-axis conductor mouth; the named inner face is the wiring hit surface."""
    sign = -1 if end_y_mm < 0 else 1
    well_y = end_y_mm - sign * 0.35
    cylinder(f"entry-well:{name}", radius_mm * 1.32, 0.70, (0, well_y, z_mm), "black", root, collection, axis="Y")
    contact_y = end_y_mm - sign * 0.70
    contact = cylinder(f"terminal:{name}", radius_mm, 1.40, (0, contact_y, z_mm), "terminal", root, collection, axis="Y")
    contact["terminalId"] = name
    contact["connectionAxis"] = "Y"
    return contact


def m3_clamp(prefix: str, clamp_name: str, width_mm: float, y_mm: float, clamp_z_mm: float, head_z_mm: float, root, collection):
    """Create the visible Reakdyn-style cage clamp and its vertical M3 screw."""
    clamp = box(clamp_name, (width_mm * 0.76, 5.8, 7.0), (0, y_mm, clamp_z_mm), "terminal", root, collection, 0.28)
    box(f"jaw:{prefix}", (width_mm * 0.62, 7.2, 1.35), (0, y_mm, clamp_z_mm - 3.6), "silver", root, collection, 0.12)
    cylinder(f"screw-shaft:{prefix}", 1.32, max(4.0, head_z_mm - clamp_z_mm - 1.0), (0, y_mm, (head_z_mm + clamp_z_mm) / 2), "silver", root, collection, axis="Z")
    cylinder(f"screw-head:{prefix}", 2.15, 1.25, (0, y_mm, head_z_mm), "terminal", root, collection, axis="Z")
    box(f"screw-slot:{prefix}", (width_mm * 0.72, 0.48, 0.16), (0, y_mm, head_z_mm + 0.64), "dark", root, collection, 0)
    return clamp


def text_label(body: str, max_width_mm: float, height_mm: float, location_mm: Sequence[float], parent, collection, mat: str = "white"):
    curve = bpy.data.curves.new(f"label:{body}", type="FONT")
    curve.body = body
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    curve.size = height_mm * MM
    curve.extrude = 0.05 * MM
    curve.resolution_u = 2
    obj = bpy.data.objects.new(f"label:{body}", curve)
    collection.objects.link(obj)
    obj.parent = parent
    obj.rotation_euler = (math.pi / 2, 0, 0)
    obj.location = tuple(value * MM for value in location_mm)
    obj.data.materials.append(material(mat))
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj.select_set(False)
    if obj.dimensions.x > max_width_mm * MM:
        factor = max_width_mm * MM / obj.dimensions.x
        obj.scale *= factor
    return obj


def terminal(name: str, x_mm: float, z_mm: float, front_y_mm: float, radius_mm: float, parent, collection):
    screw = cylinder(f"terminal:{name}", radius_mm, 1.4, (x_mm, front_y_mm + 0.7, z_mm), "terminal", parent, collection)
    # The slot is a sibling of the screw.  Parenting it to the already
    # translated screw would apply the absolute terminal coordinates twice and
    # place the slot outside the equipment in the exported GLB.
    slot = box(f"terminal-slot:{name}", (radius_mm * 1.35, 0.30, max(0.35, radius_mm * 0.22)), (x_mm, front_y_mm + 0.15, z_mm), "dark", parent, collection, bevel_mm=0)
    slot.rotation_euler.y = math.radians(20)
    return screw


def terminal_rows(root, collection, ids: Sequence[str], width: float, height: float, depth: float, row_lengths: Sequence[int]) -> None:
    cursor = 0
    rows = len(row_lengths)
    margin_x = max(2.0, min(6.0, width * 0.075))
    usable = width - 2 * margin_x
    radius = max(0.85, min(2.25, usable / max(row_lengths) * 0.27, height / (rows + 2) * 0.15))
    if rows == 1:
        z_positions = [0.0]
    else:
        z_positions = [(-height * 0.38) + index * (height * 0.76 / (rows - 1)) for index in range(rows)]
    for row, count in enumerate(row_lengths):
        row_ids = ids[cursor:cursor + count]
        cursor += count
        if count == 1:
            x_positions = [0.0]
        else:
            x_positions = [(-usable / 2) + index * (usable / (count - 1)) for index in range(count)]
        for terminal_id, x in zip(row_ids, x_positions):
            terminal(terminal_id, x, z_positions[row], -depth / 2, radius, root, collection)
    if cursor != len(ids):
        raise ValueError(f"terminal row layout consumed {cursor} of {len(ids)} terminals")


def front_terminal(name: str, x_mm: float, z_mm: float, front_y_mm: float, radius_mm: float, parent, collection):
    """Create a front-facing recessed terminal with a readable cross slot."""
    cylinder(
        f"terminal-well:{name}",
        radius_mm * 1.38,
        0.80,
        (x_mm, front_y_mm + 0.40, z_mm),
        "black",
        parent,
        collection,
    )
    screw = cylinder(
        f"terminal:{name}",
        radius_mm,
        1.20,
        (x_mm, front_y_mm + 0.60, z_mm),
        "terminal",
        parent,
        collection,
    )
    slot_depth = 0.08
    slot_offset = front_y_mm + slot_depth / 2
    box(
        f"terminal-slot-h:{name}",
        (radius_mm * 1.42, slot_depth, max(0.38, radius_mm * 0.24)),
        (x_mm, slot_offset, z_mm),
        "dark",
        parent,
        collection,
        bevel_mm=0,
    )
    box(
        f"terminal-slot-v:{name}",
        (max(0.38, radius_mm * 0.24), slot_depth, radius_mm * 1.42),
        (x_mm, slot_offset, z_mm),
        "dark",
        parent,
        collection,
        bevel_mm=0,
    )
    return screw


def validate_terminal_layout(spec, rows: Sequence[Sequence[str]]) -> None:
    laid_out = [terminal_id for row in rows for terminal_id in row]
    expected = list(spec["terminals"])
    if len(laid_out) != len(set(laid_out)):
        raise ValueError(f"duplicate terminal in {spec['model']} visual layout")
    if set(laid_out) != set(expected):
        missing = sorted(set(expected) - set(laid_out))
        unexpected = sorted(set(laid_out) - set(expected))
        raise ValueError(f"{spec['model']} terminal layout mismatch; missing={missing}, unexpected={unexpected}")


def root_for(spec, collection):
    root = bpy.data.objects.new(f"equipment:{spec['file']}", None)
    collection.objects.link(root)
    root["model"] = spec["model"]
    root["manual"] = spec["manual"]
    root["manualPages"] = json.dumps(spec["pages"], separators=(",", ":"))
    root["physicalDimensionsMm"] = json.dumps(spec["dimensions"], separators=(",", ":"))
    return root


def build_plc(spec, root, collection):
    dims = spec["dimensions"]
    w, h, d = dims["width"], dims["height"], dims["depth"]
    front_y = -d / 2

    # Overall manual envelope: 114 W x 100 H x 64 D.  The terminal blocks and
    # decorative faces are inset so the exported mesh never exceeds it.
    box("housing:xbc", (w, d, h), (0, 0, 0), "ivory", root, collection, 1.6)
    box("rear:xbc", (w - 4, 3.0, h - 5), (0, d / 2 - 1.5, 0), "dark", root, collection, 0.8)

    # Three distinct central front zones match the H-type main-unit drawing.
    panel_y = front_y + 0.90
    box("panel:xbc-status", (28, 1.80, 54), (-42, panel_y, 0), "panel", root, collection, 0.7)
    box("panel:xbc-io", (44, 1.80, 54), (-6, panel_y, 0), "light-gray", root, collection, 0.7)
    box("panel:xbc-battery", (38, 1.80, 54), (35, panel_y, 0), "panel", root, collection, 0.7)
    for divider_x in (-28, 16):
        box(f"panel:xbc-divider-{divider_x}", (0.65, 0.42, 52), (divider_x, front_y + 0.21, 0), "dark", root, collection, 0.1)

    # XGB nameplate and the three CPU status indicators.  The manual specifies
    # PWR red, RUN green, and ERR red for this H-type unit.
    box("brand:xgb", (20, 0.45, 6.0), (-42, front_y + 0.225, 16.5), "red", root, collection, 0.35)
    text_label("XGB", 16, 3.4, (-42, front_y + 0.10, 16.5), root, collection)
    text_label("XBC-DR32H", 23, 2.8, (-42, front_y + 0.10, 10.5), root, collection, "dark")
    status_leds = (
        ("led:xbc-pwr", "PWR", "led-red", 3.0),
        ("led:xbc-run", "RUN", "led-green", -2.2),
        ("led:xbc-err", "ERR", "led-red", -7.4),
    )
    for node_name, label, mat, z in status_leds:
        cylinder(node_name, 1.25, 0.80, (-51, front_y + 0.40, z), mat, root, collection)
        text_label(label, 10, 2.25, (-43.5, front_y + 0.10, z), root, collection, "dark")

    # Two 8x2 indicator matrices are deliberately unlit by default.  Runtime
    # code can assign emissive state without changing the physical layout.
    text_label("IN", 5, 2.5, (-24, front_y + 0.10, 12.0), root, collection, "dark")
    text_label("OUT", 7, 2.5, (-23, front_y + 0.10, -7.0), root, collection, "dark")
    for group, prefix, top_z in (("input", "0", 14.0), ("output", "2", -4.0)):
        for index in range(16):
            column = index % 8
            row = index // 8
            x = -17.0 + column * 3.65
            z = top_z - row * 4.0
            box(
                f"led:xbc-{group}-{prefix}{index:X}",
                (1.65, 0.40, 1.65),
                (x, front_y + 0.20, z),
                "black",
                root,
                collection,
                0.18,
            )
    ls_brand = text_label("LS", 11, 4.5, (8.5, front_y + 0.10, 0.5), root, collection, "dark")
    ls_brand.name = "brand:ls"

    # Battery door relief, finger notch, and mode switch are visible on the
    # right third of the front panel.
    for index, x in enumerate((43.5, 47.0, 50.5)):
        box(f"cover:xbc-battery-groove-{index}", (0.75, 0.32, 10 + index * 3), (x, front_y + 0.16, 1.0), "light-gray", root, collection, 0.2)
    cylinder("cover:xbc-battery-notch", 3.0, 0.55, (52.0, front_y + 0.275, 0), "dark", root, collection)
    box("switch:xbc-mode", (3.8, 0.50, 2.1), (51.0, front_y + 0.25, -20.0), "black", root, collection, 0.2)

    input_top = ("RX", "TX", "SG", "P01", "P03", "P05", "P07", "P09", "P0B", "P0D", "P0F", "24G")
    input_bottom = ("485+", "485-", "P00", "P02", "P04", "P06", "P08", "P0A", "P0C", "P0E", "COMI", "24V")
    output_top = ("L", "N", "P20", "P22", "COM0", "P25", "P27", "P28", "P2A", "COM2", "P2D", "P2F")
    output_bottom = ("PE", "NC", "P21", "P23", "P24", "P26", "COM1", "P29", "P2B", "P2C", "P2E", "COM3")
    rows = (input_top, input_bottom, output_top, output_bottom)
    validate_terminal_layout(spec, rows)

    bank_y = front_y + 1.50
    box("terminal-bank:xbc-input", (112, 3.0, 23), (0, bank_y, 38.5), "dark", root, collection, 0.7)
    box("terminal-bank:xbc-output", (112, 3.0, 23), (0, bank_y, -38.5), "dark", root, collection, 0.7)
    x_positions = tuple(-46.75 + index * 8.5 for index in range(12))
    for bank_name, center_z in (("input", 38.5), ("output", -38.5)):
        box(f"terminal-bank:xbc-{bank_name}-divider", (110, 0.55, 0.75), (0, front_y + 0.28, center_z), "gray", root, collection, 0.1)
        for index in range(11):
            separator_x = (x_positions[index] + x_positions[index + 1]) / 2
            box(
                f"terminal-bank:xbc-{bank_name}-separator-{index}",
                (0.70, 0.55, 21.0),
                (separator_x, front_y + 0.28, center_z),
                "gray",
                root,
                collection,
                0.08,
            )

    visual_rows = (
        (input_top, 44.0, 40.4),
        (input_bottom, 33.0, 36.7),
        (output_top, -33.0, -36.7),
        (output_bottom, -44.0, -40.4),
    )
    for row_ids, screw_z, label_z in visual_rows:
        for terminal_id, x in zip(row_ids, x_positions):
            front_terminal(terminal_id, x, screw_z, front_y, 2.20, root, collection)
            visible_label = "COM" if terminal_id == "COMI" else terminal_id
            text_label(visible_label, 7.1, 1.55, (x, front_y + 0.10, label_z), root, collection, "white")

    # Side expansion-connector cover and rear DIN-rail latches complete the
    # silhouette visible in Appendix A2-2.
    box("cover:xbc-expansion", (0.90, 22, 28), (w / 2 - 0.45, 6.0, 4.0), "dark", root, collection, 0.45)
    for z in (-5.0, 13.0):
        cylinder(f"cover:xbc-expansion-screw-{z}", 0.85, 0.70, (w / 2 - 0.35, 6.0, z), "terminal", root, collection, axis="X")
    box("din:xbc-upper-hook", (35, 2.0, 5.0), (0, d / 2 - 1.0, 18.0), "black", root, collection, 0.4)
    box("din:xbc-lower-latch", (24, 2.0, 8.0), (0, d / 2 - 1.0, -22.0), "black", root, collection, 0.4)


def build_power_supply(spec, root, collection):
    dims = spec["dimensions"]
    w, h, d = dims["width"], dims["height"], dims["depth"]
    front_y = -d / 2

    # The official product photo shows a blue side shell wrapped around a
    # cream front cover, not a bare silver electrical enclosure.
    box("housing:mdr", (w, d, h), (0, 0, 0), "blue-shell", root, collection, 1.5)
    box("front:mdr", (w - 4.0, 2.0, h - 4.0), (0, front_y + 1.0, 0), "cream", root, collection, 1.2)

    # Two banks of deep ventilation slots occupy the side shell.  They are
    # repeated along the 100 mm depth and remain flush inside the rated width.
    vent_x = w / 2 - 0.06
    vent_y_positions = tuple(-25.0 + index * 4.6 for index in range(14))
    for side, x in (("left", -vent_x), ("right", vent_x)):
        for index, y in enumerate(vent_y_positions):
            for band, z in (("upper", 28.0), ("lower", -28.0)):
                name = f"vent:mdr-{side}-{index}" if band == "upper" else f"vent:mdr-{side}-lower-{index}"
                box(name, (0.12, 1.65, 18.0), (x, y, z), "dark", root, collection, 0.03)

    # Terminal center spacing is taken directly from the mechanical drawing:
    # six output/DC-OK screws at 5 mm pitch, three AC-input screws at 7.5 mm.
    top_ids = ("V+1", "V+2", "V-1", "V-2", "DCOK-A", "DCOK-B")
    bottom_ids = ("PE", "N", "L")
    validate_terminal_layout(spec, (top_ids, bottom_ids))
    box("terminal-bank:mdr-output", (34, 2.0, 11.0), (0, front_y + 1.0, 38.0), "pcb-green", root, collection, 0.7)
    box("terminal-bank:mdr-input", (24, 2.0, 11.0), (0, front_y + 1.0, -38.0), "pcb-green", root, collection, 0.7)
    top_positions = (-12.5, -7.5, -2.5, 2.5, 7.5, 12.5)
    bottom_positions = (-7.5, 0.0, 7.5)
    for terminal_id, x in zip(top_ids, top_positions):
        front_terminal(terminal_id, x, 38.0, front_y, 1.75, root, collection)
    for terminal_id, x in zip(bottom_ids, bottom_positions):
        front_terminal(terminal_id, x, -38.0, front_y, 1.95, root, collection)
    for label, x in zip(("+V", "+V", "-V", "-V"), top_positions[:4]):
        text_label(label, 4.2, 1.7, (x, front_y + 0.10, 32.0), root, collection, "dark")
    text_label("DC OK", 10, 1.7, (10.0, front_y + 0.10, 32.0), root, collection, "dark")
    for label, x in zip(("PE", "N", "L"), bottom_positions):
        text_label(label, 5.0, 1.8, (x, front_y + 0.10, -31.0), root, collection, "dark")

    # Front controls and permanent markings from the MDR-100-24 nameplate.
    cylinder("indicator:mdr-dc-ok", 1.80, 0.90, (10.0, front_y + 0.45, 21.0), "led-green", root, collection)
    text_label("DC OK", 12, 2.2, (10.0, front_y + 0.10, 25.0), root, collection, "dark")
    cylinder("control:mdr-v-adj", 2.15, 0.90, (-10.0, front_y + 0.45, 18.0), "black", root, collection)
    box("control:mdr-v-adj-slot", (2.7, 0.08, 0.48), (-10.0, front_y + 0.04, 18.0), "terminal", root, collection, bevel_mm=0)
    text_label("+V ADJ", 14, 2.2, (-10.0, front_y + 0.10, 13.7), root, collection, "dark")
    box("brand:mean-well", (18.0, 0.45, 8.0), (0, front_y + 0.225, 3.0), "red", root, collection, 0.3)
    text_label("MW", 14, 4.2, (0, front_y + 0.10, 4.2), root, collection)
    text_label("MEAN WELL", 14, 1.6, (0, front_y + 0.10, 0.7), root, collection)
    text_label("MDR-100-24", w - 10, 4.1, (0, front_y + 0.10, -6.0), root, collection, "dark")
    text_label("INPUT 100-240VAC", w - 10, 2.2, (0, front_y + 0.10, -14.5), root, collection, "dark")
    text_label("24V 4A", 18, 2.2, (0, front_y + 0.10, -19.0), root, collection, "dark")

    # Rear hooks reproduce the TS35/7.5 and TS35/15 DIN-rail attachment shown
    # in the installation guide while staying inside the 100 mm depth.
    box("din:mdr-upper-hook", (30, 1.6, 7.0), (0, d / 2 - 0.8, 19.0), "dark", root, collection, 0.5)
    box("din:mdr-rail-channel", (33, 1.2, 12.0), (0, d / 2 - 0.6, 0), "ivory", root, collection, 0.4)
    box("din:mdr-lower-clip", (22, 1.6, 10.0), (0, d / 2 - 0.8, -21.0), "dark", root, collection, 0.5)


def build_contactor(spec, root, collection):
    dims = spec["dimensions"]
    w, h, d = dims["width"], dims["height"], dims["depth"]
    front_y = -d / 2

    # The 24 VDC model has the catalogue's extended dark rear chassis.  Keep
    # the maximum 103.6 mm depth while building the stepped 45 mm front shell.
    box("housing:mc", (w - 2, d - 1.2, h - 4), (0, 0.6, 0), "dark", root, collection, 1.1)
    box("housing:mc-front", (w - 3, 17, 64), (-1.5, front_y + 8.5, -0.5), "ivory", root, collection, 1.0)
    box("housing:mc-top-ledger", (w - 3, 17, 15), (-1.5, front_y + 8.5, 27), "ivory", root, collection, 0.7)
    box("housing:mc-bottom-ledger", (w - 3, 17, 15), (-1.5, front_y + 8.5, -27), "ivory", root, collection, 0.7)
    box("mount:mc-left-ear", (5.5, d - 14, 15), (-w / 2 + 3, 6, h / 2 - 9.5), "dark", root, collection, 1.0)
    box("mount:mc-right-ear", (5.5, d - 14, 15), (w / 2 - 3, 6, h / 2 - 9.5), "dark", root, collection, 1.0)
    box("din:mc-foot", (22, 18, 7), (0, d / 2 - 9, -h / 2 + 3.5), "black", root, collection, 0.8)

    # Main line/load terminals use the 10.9 mm pitch shown on catalogue p125.
    for terminal_id, x, z in (
        ("1L1", -10.9, 28), ("3L2", 0, 28), ("5L3", 10.9, 28),
        ("2T1", -10.9, -28), ("4T2", 0, -28), ("6T3", 10.9, -28),
    ):
        cylinder(f"well:mc-{terminal_id}", 4.4, 1.3, (x - 1.5, front_y + 0.65, z), "black", root, collection)
        terminal(terminal_id, x - 1.5, z, front_y, 3.0, root, collection)

    # The integrated 1a1b auxiliary strip makes the front deliberately
    # asymmetric.  Its visible screws are 13 and 22; 14 and 21 sit on the
    # stepped return surfaces beside the printed NO/NC contact windows.
    aux_x = w / 2 - 4.1
    box("aux:mc-1a1b", (8.2, 17, 55), (aux_x, front_y + 8.5, -1), "ivory", root, collection, 0.7)
    for terminal_id, x, z in (
        ("13", aux_x, 20), ("14", aux_x, 8), ("21", aux_x, -8), ("22", aux_x, -20),
    ):
        terminal(terminal_id, x, z, front_y, 2.1, root, collection)
    box("window:mc-no", (4.2, 0.8, 1.3), (aux_x, front_y + 0.4, 3.5), "black", root, collection, 0.1)
    box("window:mc-nc", (4.2, 0.8, 1.3), (aux_x, front_y + 0.4, -3.5), "black", root, collection, 0.1)

    # A1/A2 are the duplicated, internally common DC-coil connections at the
    # rear corners.  One clickable surface per electrical terminal is exposed.
    for terminal_id, z in (("A1", h / 2 - 7), ("A2", -h / 2 + 7)):
        box(f"coil-block:mc-{terminal_id}", (6.8, 11, 9), (w / 2 - 3.4, -1, z), "dark", root, collection, 0.6)
        terminal(terminal_id, w / 2 - 3.4, z, -7.1, 2.1, root, collection)

    box("mechanism:mc-armature", (25, 4.5, 31), (-3, front_y + 2.25, -1), "gray", root, collection, 1.0)
    box("mechanism:mc-cage-left", (4, 1.8, 24), (-11, front_y + 0.9, -1), "dark", root, collection, 0.4)
    box("mechanism:mc-cage-right", (4, 1.8, 24), (5, front_y + 0.9, -1), "dark", root, collection, 0.4)
    box("mechanism:mc-orange", (5.5, 1.9, 13), (-7, front_y + 0.95, -1), "orange", root, collection, 0.7)
    box("mechanism:mc-orange-right", (5.5, 1.9, 13), (1, front_y + 0.95, -1), "orange", root, collection, 0.7)
    box("mechanism:mc-manual", (8, 1.6, 7), (-3, front_y + 0.8, 16), "white", root, collection, 0.7)
    text_label("MC-22b", 14, 3.2, (-12, front_y + 0.10, 10), root, collection, "dark")
    text_label("LS", 8, 3.3, (2, front_y + 0.10, -19), root, collection, "dark")
    text_label("DC24V 1a1b", 15, 2.2, (-11, front_y + 0.10, -20), root, collection, "dark")
    brand = box("brand:ls-mc", (0.8, 0.4, 0.8), (0, front_y + 0.2, -18), "dark", root, collection, 0.1)
    brand.hide_render = True


def build_relay(spec, root, collection):
    dims = spec["dimensions"]
    w, h, d = dims["width"], dims["height"], dims["depth"]
    base_center_z = -8.5
    base_height = 6.2
    box("base:my2n", (w - 0.8, d - 1.0, base_height), (0, 0.3, base_center_z), "black", root, collection, 0.7)
    box("coil:my2n-copper", (7.2, 16, 13), (-4.8, 1.5, 1), "coil-cream", root, collection, 1.2)
    for turn in (-4.5, -2.2, 0, 2.2, 4.5):
        box(f"coil:my2n-turn-{turn}", (0.5, 16.5, 13.5), (-4.8 + turn * 0.12, 1.5 + turn * 0.22, 1), "copper", root, collection, 0.15)
    box("armature:my2n", (4.2, 20, 2.0), (3, 0, 5.5), "terminal", root, collection, 0.2)
    box("armature:my2n-frame", (3.2, 11, 14), (3.2, 2, 0), "dark", root, collection, 0.4)
    for side in (-1, 1):
        box(f"contact:my2n-fixed-{side}", (1.1, 7, 10), (side * 7.0, 2, 1), "copper", root, collection, 0.2)
        box(f"contact:my2n-spring-{side}", (0.7, 15, 1.0), (side * 6.0, 0, 6.5), "terminal", root, collection, 0.15)
    box("runtime:coil-indicator", (3.0, 1.0, 2.0), (6.8, -d / 2 + 0.5, 6.0), "led-green", root, collection, 0.3)
    box("tape:my2n-dc-blue", (2.0, 8.5, 12), (-8.0, 2, 0), "blue", root, collection, 0.2)

    # Bottom-view pin order from Omron J219-E1 p20.  Blades, not screw heads,
    # extend 6.4 mm below the black base and remain the clickable terminals.
    x_positions = (-6.2, 6.2)
    y_positions = (-10.2, -3.4, 3.4, 10.2)
    pin_grid = (("1", "5", "9", "13"), ("4", "8", "12", "14"))
    for column, ids in enumerate(pin_grid):
        for row, terminal_id in enumerate(ids):
            blade = box(
                f"terminal:{terminal_id}",
                (1.2, 2.2, 6.4),
                (x_positions[column], y_positions[row], -h / 2 + 3.2),
                "terminal",
                root,
                collection,
                bevel_mm=0.15,
            )
            blade.rotation_euler.z = math.radians(6 if column == 0 else -6)

    text_label("MY2N-D2", w - 3, 2.1, (0, -d / 2 + 0.10, 10), root, collection, "dark")
    text_label("DC24V  14+ 13-", w - 3, 1.5, (0, -d / 2 + 0.10, 7), root, collection, "dark")
    # Add the clear shell last so the internal mechanism remains visually
    # legible through its BLEND material in exported GLB viewers.
    cover_bottom_z = base_center_z + base_height / 2
    cover_top_z = h / 2
    box("cover:my2n-transparent", (w, d, cover_top_z - cover_bottom_z), (0, 0, (cover_top_z + cover_bottom_z) / 2), "clear", root, collection, 0.8)


def build_overload(spec, root, collection):
    dims = spec["dimensions"]
    w, h, d = dims["width"], dims["height"], dims["depth"]
    front_y = -d / 2
    box("housing:eocr", (w, d - 1.0, h), (0, 0.5, 0), "dark", root, collection, 1.7)
    box("panel:eocr-front", (w - 3, 3.0, h - 4), (0, front_y + 1.5, 0), "dark", root, collection, 1.0)
    box("display:eocr-7segment", (39, 1.1, 17), (-6, front_y + 0.55, 12), "black", root, collection, 0.7)
    text_label("8.00", 28, 8.2, (-5, front_y + 0.10, 12), root, collection, "led-cyan")
    text_label("EOCR3DE", 22, 3.1, (-19, front_y + 0.10, 28), root, collection)
    text_label("Schneider", 18, 2.6, (19, front_y + 0.10, 28), root, collection)
    brand = box("brand:schneider", (0.8, 0.4, 0.8), (19, front_y + 0.2, 26), "white", root, collection, 0.1)
    brand.hide_render = True

    for index, z in enumerate((17, 12, 7), start=1):
        box(f"indicator:eocr-l{index}", (1.6, 0.6, 1.6), (-28, front_y + 0.3, z), "led-green", root, collection, 0.2)
    for name in ("set", "dn", "up", "reset"):
        # Actual H-unit controls are a vertical stack at the right edge:
        # ESC, UP, DN and SET (the runtime labels RESET/SET equivalently).
        actual_z = {"reset": 25, "up": 14, "dn": 3, "set": -8}[name]
        box(f"button:eocr-{name}", (6.2, 0.9, 6.2), (27, front_y + 0.45, actual_z), "gray", root, collection, 1.0)
        text_label({"reset": "ESC", "up": "UP", "dn": "DN", "set": "SET"}[name], 5.2, 1.3, (27, front_y + 0.10, actual_z), root, collection)

    # One eight-way screw row across the lower face, exact manual order.
    terminal_order = ("A1", "A2", "07", "08", "95", "96", "97", "98")
    x_positions = tuple(-28 + index * 8 for index in range(8))
    for terminal_id, x in zip(terminal_order, x_positions):
        terminal(terminal_id, x, -27, front_y, 2.2, root, collection)
        text_label(terminal_id, 6.4, 1.35, (x, front_y + 0.10, -21.5), root, collection)

    # H suffix: three phase cables pass through Ø12 CT tunnels.  Their mouths
    # are on both X side faces, vertically stacked at 21.4 mm pitch.  Each
    # electrical IN/OUT node is an actual dark picking surface at the mouth.
    for index, z in enumerate((21.4, 0, -21.4), start=1):
        cylinder(f"ct:eocr-l{index}", 6.0, w - 2, (0, 17, z), "black", root, collection, axis="X")
        for side, suffix in ((-1, "IN"), (1, "OUT")):
            terminal_id = f"L{index}-{suffix}"
            cylinder(
                f"ct-mouth:eocr-l{index}-{suffix.lower()}",
                6.35,
                0.55,
                (side * (w / 2 - 0.275), 17, z),
                "dark",
                root,
                collection,
                axis="X",
            )
            mouth = cylinder(
                f"terminal:{terminal_id}",
                5.4,
                0.35,
                (side * (w / 2 - 0.175), 17, z),
                "black",
                root,
                collection,
                axis="X",
            )
            mouth["terminalId"] = terminal_id
    box("din:eocr-foot", (28, 16, 6), (0, d / 2 - 8, -h / 2 + 3), "black", root, collection, 0.8)


def build_ut25_frame(spec, root, collection, protective_earth: bool) -> None:
    """Build the open-sided UT 2,5 screw-terminal profile from the catalog photo."""
    dims = spec["dimensions"]
    w, h, d = dims["width"], dims["height"], dims["depth"]
    body = "pe-yellow" if protective_earth else "ral7042"
    slug = "ut25-pe" if protective_earth else "ut25"

    # The real part is an open, ribbed 5.2 mm side profile rather than a filled
    # 46.9 x 47.7 mm block.  These pieces leave the cage clamps and bus visible.
    side_prism(
        f"profile:{slug}",
        w,
        ((-20.5, -16.8), (20.5, -16.8), (18.8, -9.0), (13.0, -6.0), (-13.0, -6.0), (-18.8, -9.0)),
        body,
        root,
        collection,
    )
    left_tower = ((-23.0, 7.0), (-20.5, 18.5), (-16.5, 22.8), (-8.8, 22.8), (-5.5, 13.0), (-9.0, 4.0), (-18.0, 1.0))
    side_prism(f"frame:{slug}-left-tower", w, left_tower, body, root, collection)
    side_prism(f"frame:{slug}-right-tower", w, tuple((-y, z) for y, z in reversed(left_tower)), body, root, collection)
    side_prism(f"rib:{slug}-left", w, ((-21.2, -8.5), (-18.2, 1.5), (-10.0, 5.0), (-13.5, -7.0)), body, root, collection)
    side_prism(f"rib:{slug}-right", w, ((21.2, -8.5), (13.5, -7.0), (10.0, 5.0), (18.2, 1.5)), body, root, collection)
    box(f"marker-channel:{slug}", (w, 11.0, 3.2), (0, 0, 11.8), body, root, collection, 0.25)
    box(f"center-web:{slug}", (w, 3.0, 15.0), (0, 0, -0.5), body, root, collection, 0.2)

    terminal_entry("1", -d / 2, 9.5, 1.65, root, collection)
    terminal_entry("2", d / 2, 9.5, 1.65, root, collection)
    metal = "silver" if protective_earth else "copper"
    box(f"conductor:{slug}-left", (w * 0.54, 10.8, 1.65), (0, -17.1, 9.5), metal, root, collection, 0.12)
    box(f"conductor:{slug}-right", (w * 0.54, 10.8, 1.65), (0, 17.1, 9.5), metal, root, collection, 0.12)
    m3_clamp(slug + "-left", f"clamp:{slug}-left", w, -11.5, 6.0, 18.2, root, collection)
    m3_clamp(slug + "-right", f"clamp:{slug}-right", w, 11.5, 6.0, 18.2, root, collection)

    bridge_name = f"bridge:{slug}" if protective_earth else "bridge:ut25-copper"
    box(bridge_name, (w * 0.66, 23.0, 1.45), (0, 0, 2.2), metal, root, collection, 0.12)
    box(f"bridge-rise:{slug}-left", (w * 0.62, 1.5, 5.2), (0, -11.5, 4.6), metal, root, collection, 0.1)
    box(f"bridge-rise:{slug}-right", (w * 0.62, 1.5, 5.2), (0, 11.5, 4.6), metal, root, collection, 0.1)

    # Snap-on NS 35 foot: a fixed J hook at one edge and a sprung latch at the
    # other.  The rail itself is intentionally not baked into the equipment.
    foot_name = f"din:{slug}-foot"
    foot_material = "silver" if protective_earth else body
    side_prism(foot_name, w * 0.90, ((-19.5, -16.0), (-12.5, -16.0), (-12.5, -21.2), (-15.5, -23.2), (-20.5, -21.0)), foot_material, root, collection, 0.12)
    side_prism(f"din:{slug}-latch", w * 0.90, ((19.5, -16.0), (20.5, -21.0), (15.5, -23.2), (12.5, -21.2), (12.5, -16.0)), foot_material, root, collection, 0.12)
    box(f"din:{slug}-crown", (w * 0.90, 26.0, 2.0), (0, 0, -17.0), foot_material, root, collection, 0.1)

    if protective_earth:
        # The PE version bonds both cages to the DIN rail through an exposed
        # spring-metal U foot; it is not merely a recolored feed-through block.
        box("grounding-strap:ut25-pe", (w * 0.62, 1.6, 19.0), (0, 0, -7.2), "silver", root, collection, 0.1)
        box("grounding-spring:ut25-pe", (w * 0.68, 26.0, 1.25), (0, 0, -21.3), "silver", root, collection, 0.08)
        box("grounding-contact:ut25-pe-left", (w * 0.68, 1.25, 6.0), (0, -13.0, -18.7), "silver", root, collection, 0.08)
        box("grounding-contact:ut25-pe-right", (w * 0.68, 1.25, 6.0), (0, 13.0, -18.7), "silver", root, collection, 0.08)
        # Thin green surface bands reproduce the molded green/yellow PE code
        # without covering the open clamp windows.
        for side_index, x in enumerate((-w / 2 + 0.06, w / 2 - 0.06)):
            box(f"pe-band:tower-left-{side_index}", (0.12, 4.2, 14.0), (x, -14.5, 12.0), "pe-green", root, collection, 0.02)
            box(f"pe-band:tower-right-{side_index}", (0.12, 4.2, 14.0), (x, 14.5, 12.0), "pe-green", root, collection, 0.02)
            box(f"pe-band:base-{side_index}", (0.12, 13.0, 2.4), (x, 0, -12.0), "pe-green", root, collection, 0.02)


def build_ut25(spec, root, collection):
    build_ut25_frame(spec, root, collection, protective_earth=False)


def build_ut25_pe(spec, root, collection):
    build_ut25_frame(spec, root, collection, protective_earth=True)


def build_ut4_hesi(spec, root, collection):
    """Build the closed-side UT 4-HESI with its 5x20 carrier visibly open."""
    dims = spec["dimensions"]
    w, h, d = dims["width"], dims["height"], dims["depth"]

    side_prism(
        "profile:ut4-hesi",
        w,
        ((-36.6, -24.5), (36.6, -24.5), (35.0, -15.0), (30.0, -11.0), (-30.0, -11.0), (-35.0, -15.0)),
        "black",
        root,
        collection,
        0.20,
    )
    left_shoulder = ((-37.2, -11.0), (-34.0, 0.0), (-27.0, 9.0), (-18.0, 9.0), (-15.0, 3.0), (-20.0, -8.0), (-30.0, -12.0))
    side_prism("frame:ut4-hesi-left", w, left_shoulder, "black", root, collection, 0.20)
    side_prism("frame:ut4-hesi-right", w, tuple((-y, z) for y, z in reversed(left_shoulder)), "black", root, collection, 0.20)
    box("spine:ut4-hesi", (w, 8.0, 21.0), (0, 0, -1.0), "black", root, collection, 0.25)
    side_prism("hinge-support:ut4-hesi", w, ((5.0, 6.0), (18.0, 6.0), (18.0, 12.5), (11.0, 14.0), (5.0, 11.0)), "black", root, collection, 0.18)

    terminal_entry("1", -d / 2, -4.0, 2.0, root, collection)
    terminal_entry("2", d / 2, -4.0, 2.0, root, collection)
    box("conductor:ut4-hesi-left", (w * 0.54, 13.2, 1.9), (0, -31.0, -4.0), "copper", root, collection, 0.12)
    box("conductor:ut4-hesi-right", (w * 0.54, 13.2, 1.9), (0, 31.0, -4.0), "copper", root, collection, 0.12)
    m3_clamp("ut4-hesi-left", "clamp:ut4-hesi-left", w, -24.0, -6.0, 3.8, root, collection)
    m3_clamp("ut4-hesi-right", "clamp:ut4-hesi-right", w, 24.0, -6.0, 3.8, root, collection)
    box("current-path:ut4-hesi-left", (w * 0.50, 2.0, 14.0), (0, -24.0, 2.0), "copper", root, collection, 0.10)
    box("current-path:ut4-hesi-right", (w * 0.50, 2.0, 14.0), (0, 24.0, 2.0), "copper", root, collection, 0.10)

    # The catalog product is shipped without the fuse-link.  Model the long
    # lever open, expose both spring clips, and retain an Empty named fuse:5x20
    # as the precise optional-install location for the runtime.
    angle = math.radians(20)
    carrier_length = 44.0
    pivot_y, pivot_z = 12.0, 10.0
    carrier_y = pivot_y - math.cos(angle) * carrier_length / 2
    carrier_z = pivot_z + math.sin(angle) * carrier_length / 2
    carrier = box("carrier:ut4-hesi", (w * 0.90, carrier_length, 5.5), (0, carrier_y, carrier_z), "black", root, collection, 0.30)
    carrier.rotation_euler.x = -angle
    cylinder("hinge:ut4-hesi", 2.8, w * 0.92, (0, pivot_y, pivot_z), "terminal", root, collection, axis="X")

    def carrier_point(distance_mm: float) -> tuple[float, float]:
        return (
            pivot_y - math.cos(angle) * distance_mm,
            pivot_z + math.sin(angle) * distance_mm,
        )

    free_y, free_z = carrier_point(42.0)
    grip = box("carrier-grip:ut4-hesi", (w * 0.96, 4.0, 7.5), (0, free_y, free_z), "black", root, collection, 0.22)
    grip.rotation_euler.x = -angle
    for label, distance in (("left", 12.0), ("right", 32.0)):
        clip_y, clip_z = carrier_point(distance)
        clip = box(f"fuse-clip:ut4-hesi-{label}", (w * 0.66, 3.4, 2.0), (0, clip_y, clip_z - 1.2), "copper", root, collection, 0.10)
        clip.rotation_euler.x = -angle
        cylinder(f"test-pickoff:ut4-hesi-{label}", 1.15, w * 0.72, (0, clip_y, clip_z + 1.1), "terminal", root, collection, axis="X")

    fuse_y, fuse_z = carrier_point(22.0)
    fuse = empty_node("fuse:5x20", (0, fuse_y, fuse_z), root, collection)
    fuse["installed"] = False
    fuse["fuseDiameterMm"] = 5.0
    fuse["fuseLengthMm"] = 20.0
    fuse["note"] = "Optional G 5x20 fuse-link; not supplied with Phoenix Contact item 3046032"

    side_prism("din:ut4-hesi-foot", w * 0.90, ((-20.0, -22.5), (-12.5, -22.5), (-12.5, -27.0), (-16.0, -28.2), (-21.0, -26.0)), "black", root, collection, 0.12)
    side_prism("din:ut4-hesi-latch", w * 0.90, ((20.0, -22.5), (21.0, -26.0), (16.0, -28.2), (12.5, -27.0), (12.5, -22.5)), "black", root, collection, 0.12)
    box("din:ut4-hesi-crown", (w * 0.90, 27.0, 1.8), (0, 0, -23.2), "black", root, collection, 0.10)


BUILDERS = {
    "plc": build_plc,
    "power-supply": build_power_supply,
    "contactor": build_contactor,
    "relay": build_relay,
    "overload-relay": build_overload,
    "terminal-block": build_ut25,
    "pe-terminal-block": build_ut25_pe,
    "fused-terminal-block": build_ut4_hesi,
}


def descendants(root) -> Iterable:
    yield root
    for child in root.children:
        yield from descendants(child)


def export_glb(root, destination: Path) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in descendants(root):
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(destination),
        export_format="GLB",
        use_selection=True,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_extras=True,
    )
    bpy.ops.object.select_all(action="DESELECT")


def actual_mesh_bounds_mm(root) -> dict:
    """Return evaluated mesh bounds in exported glTF width/height/depth axes."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    points = []
    for obj in descendants(root):
        if obj.type != "MESH":
            continue
        evaluated = obj.evaluated_get(depsgraph)
        points.extend(evaluated.matrix_world @ Vector(corner) for corner in evaluated.bound_box)
    if not points:
        raise ValueError(f"{root.name} has no mesh geometry")
    blender_min = [min(point[axis] for point in points) * 1000 for axis in range(3)]
    blender_max = [max(point[axis] for point in points) * 1000 for axis in range(3)]
    # Blender exports Z-up coordinates to glTF Y-up: X -> X, Z -> Y, -Y -> Z.
    return {
        "min": [round(blender_min[0], 6), round(blender_min[2], 6), round(-blender_max[1], 6)],
        "max": [round(blender_max[0], 6), round(blender_max[2], 6), round(-blender_min[1], 6)],
    }


def build_manifest_entry(spec, glb_path: Path, root) -> dict:
    dims = spec["dimensions"]
    return {
        "file": spec["file"],
        "model": spec["model"],
        "kind": spec["kind"],
        "physicalDimensionsMm": dims,
        "boundsAxes": ["width", "height", "depth"],
        "boundsMm": actual_mesh_bounds_mm(root),
        "evidence": {"manual": spec["manual"], "pages": spec["pages"]},
        "terminalNodes": spec["terminals"],
        "nodeCount": sum(1 for _ in descendants(root)),
        "bytes": glb_path.stat().st_size,
        "sha256": hashlib.sha256(glb_path.read_bytes()).hexdigest(),
    }


def main() -> None:
    root_path = repo_root()
    output_dir = root_path / "assets" / "manual-backed"
    output_dir.mkdir(parents=True, exist_ok=True)
    for spec in MODELS:
        evidence = root_path / spec["manual"]
        if not evidence.is_file():
            raise FileNotFoundError(f"manual evidence missing: {evidence}")

    assert_safe_scene()
    clear_scene()
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "METERS"
    scene.unit_settings.scale_length = 1.0
    scene["generator"] = "scripts/generate_manual_3d_assets.py"
    scene["sourceTool"] = "Blender 5.2"

    entries = []
    model_roots = []
    for spec in MODELS:
        collection = bpy.data.collections.new(f"manual:{spec['file']}")
        scene.collection.children.link(collection)
        asset_root = root_for(spec, collection)
        BUILDERS[spec["kind"]](spec, asset_root, collection)
        bpy.context.view_layer.update()
        for obj in descendants(asset_root):
            if obj.name.startswith("terminal:"):
                obj["terminalId"] = obj.name.removeprefix("terminal:")
        glb_path = output_dir / spec["file"]
        export_glb(asset_root, glb_path)
        entries.append(build_manifest_entry(spec, glb_path, asset_root))
        model_roots.append(asset_root)
        # Blender object names are global across collections.  Free the exact
        # terminal:<ID> names after each export so the next independently
        # loaded GLB does not inherit .001 suffixes for shared IDs such as L/N.
        # The source .blend keeps both the prefixed object name and terminalId.
        for obj in descendants(asset_root):
            if obj.name.startswith("terminal:"):
                terminal_id = obj.name.removeprefix("terminal:")
                obj["terminalId"] = terminal_id
                obj.name = f"source:{spec['file']}:{obj.name}"

    # Arrange source models side-by-side after export.  Exported GLBs remain
    # centered at their own origins while the .blend is pleasant to inspect.
    cursor_mm = 0.0
    for spec, asset_root in zip(MODELS, model_roots):
        width = spec["dimensions"]["width"]
        asset_root.location.x = (cursor_mm + width / 2) * MM
        cursor_mm += width + 28

    bpy.context.view_layer.update()
    bpy.ops.wm.save_as_mainfile(filepath=str(output_dir / "manual-backed-equipment.blend"))
    manifest = {
        "schemaVersion": 1,
        "sourceTool": "Blender 5.2",
        "sourceBlend": "manual-backed-equipment.blend",
        "units": "millimeters",
        "models": entries,
    }
    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Generated {len(entries)} manual-backed assets in {output_dir}")


if __name__ == "__main__":
    main()
