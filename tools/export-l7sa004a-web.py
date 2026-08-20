"""Create a web-ready L7SA004A GLB from the user-authored Blender scene.

The input .blend is opened by Blender itself. This script edits only the
in-memory copy, removes the studio setup, reduces geometry that is too dense
for an interactive wiring view, downsizes label textures, adds named CN1
training anchors, and exports a separate GLB.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import struct
import sys
from pathlib import Path

import bpy


CN1_TRAINING_ANCHORS_MM = {
    # CN1 front view: odd pins are the left column and even pins are the right.
    # Pins 9/10 occupy row 5; pins 11/12 occupy row 6.
    "TERM_CN1_09_PF_POS": (6.353529, -5.45, 85.175476),
    "TERM_CN1_10_PF_NEG": (9.293530, -5.45, 85.175476),
    "TERM_CN1_11_PR_POS": (6.353529, -5.45, 83.533371),
    "TERM_CN1_12_PR_NEG": (9.293530, -5.45, 83.533371),
}

DECIMATE_RATIOS = {
    "02_Plastic_Housing_Shell": 0.38,
    "44_CN1_50_Gold_Pins": 0.30,
    "48_CN2_15_Gold_Pins": 0.30,
    "08_HeatSink_Side_Screws": 0.38,
    "06_HeatSink_Fins": 0.62,
    "19_Main_Terminal_Orange_Cages": 0.45,
    "20_Main_Terminal_Rings": 0.45,
    "21_Main_Terminal_Cores": 0.45,
    "25_UVW_Terminal_Rings": 0.55,
    "26_UVW_Terminal_Cores": 0.55,
    "50_Bottom_Power_PE_Screws": 0.55,
    "45_CN1_Mount_Bosses": 0.55,
    "49_CN2_Mount_Bosses": 0.55,
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--report", required=True)
    return parser.parse_args(argv)


def triangle_count(obj: bpy.types.Object) -> int:
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


def used_images_for_object(obj: bpy.types.Object) -> set[bpy.types.Image]:
    images = set()
    for slot in obj.material_slots:
        material = slot.material
        if not material or not material.node_tree:
            continue
        for node in material.node_tree.nodes:
            if node.type == "TEX_IMAGE" and node.image:
                images.add(node.image)
    return images


def downsize_label_textures() -> list[dict]:
    resized = []
    targets = {
        "Front_Label_Texture": (256, 1352),
        "Side_Label_Texture": (384, 576),
    }
    for object_name, maximum in targets.items():
        obj = bpy.data.objects.get(object_name)
        if not obj:
            continue
        for image in used_images_for_object(obj):
            before = [int(image.size[0]), int(image.size[1])]
            scale = min(maximum[0] / max(before[0], 1), maximum[1] / max(before[1], 1), 1.0)
            after = [max(1, round(before[0] * scale)), max(1, round(before[1] * scale))]
            if after != before:
                image.scale(*after)
                image.pack()
                resized.append({"image": image.name, "before": before, "after": after, "used_by": object_name})
    return resized


def remove_studio_setup() -> list[str]:
    removed = []
    for obj in list(bpy.context.scene.objects):
        if obj.type in {"CAMERA", "LIGHT"} or obj.name == "Studio_Floor":
            removed.append(obj.name)
            bpy.data.objects.remove(obj, do_unlink=True)
    return removed


def apply_decimation() -> list[dict]:
    rows = []
    for name, ratio in DECIMATE_RATIOS.items():
        obj = bpy.data.objects.get(name)
        if not obj or obj.type != "MESH":
            continue
        before = triangle_count(obj)
        modifier = obj.modifiers.new(name="WEB_OPTIMIZE", type="DECIMATE")
        modifier.decimate_type = "COLLAPSE"
        modifier.ratio = ratio
        modifier.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        try:
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        except RuntimeError as error:
            obj.modifiers.remove(modifier)
            rows.append({"object": name, "before": before, "after": before, "ratio": 1.0, "error": str(error)})
        else:
            after = triangle_count(obj)
            rows.append({"object": name, "before": before, "after": after, "ratio": round(after / max(before, 1), 4)})
        finally:
            obj.select_set(False)
    return rows


def add_training_anchors(root: bpy.types.Object) -> list[dict]:
    world = bpy.data.objects.get("world") or root
    anchors = []
    for name, position in CN1_TRAINING_ANCHORS_MM.items():
        anchor = bpy.data.objects.new(name, None)
        anchor.empty_display_type = "SPHERE"
        anchor.empty_display_size = 1.0
        anchor.parent = world
        anchor.location = position
        anchor["terminal"] = name.replace("TERM_CN1_", "CN1-").split("_")[0]
        anchor["training_anchor"] = True
        bpy.context.scene.collection.objects.link(anchor)
        anchors.append({"name": name, "position_mm": list(position)})
    return anchors


def inline_glb_images(filepath: str) -> dict:
    """Replace GLB image bufferViews with CSP-safe data URIs.

    Binary image bytes remain in the BIN chunk so all geometry buffer offsets
    stay stable. The small duplication is preferable to a fragile whole-file
    buffer rewrite for this build asset.
    """
    original = Path(filepath).read_bytes()
    magic, version, _ = struct.unpack_from("<4sII", original, 0)
    if magic != b"glTF" or version != 2:
        raise ValueError("Expected a glTF 2.0 binary")
    json_length, json_type = struct.unpack_from("<II", original, 12)
    if json_type != 0x4E4F534A:
        raise ValueError("First GLB chunk is not JSON")
    json_start = 20
    document = json.loads(original[json_start : json_start + json_length].decode("utf-8").rstrip(" \t\r\n\0"))
    remainder = original[json_start + json_length :]
    if len(remainder) < 8:
        raise ValueError("GLB is missing its BIN chunk")
    bin_length, bin_type = struct.unpack_from("<II", remainder, 0)
    if bin_type != 0x004E4942:
        raise ValueError("Second GLB chunk is not BIN")
    binary = remainder[8 : 8 + bin_length]
    converted = []
    for image in document.get("images", []):
        view_index = image.get("bufferView")
        if view_index is None:
            continue
        view = document["bufferViews"][view_index]
        start = int(view.get("byteOffset", 0))
        end = start + int(view["byteLength"])
        mime_type = image.get("mimeType", "application/octet-stream")
        image["uri"] = f"data:{mime_type};base64,{base64.b64encode(binary[start:end]).decode('ascii')}"
        image.pop("bufferView", None)
        image.pop("mimeType", None)
        converted.append({"name": image.get("name"), "mime_type": mime_type, "bytes": end - start})
    encoded = json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    encoded += b" " * ((4 - len(encoded) % 4) % 4)
    rewritten = struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(encoded) + len(remainder))
    rewritten += struct.pack("<II", len(encoded), 0x4E4F534A) + encoded + remainder
    Path(filepath).write_bytes(rewritten)
    return {"images": converted, "bytes_before": len(original), "bytes_after": len(rewritten)}


def main() -> None:
    args = parse_args()
    output = os.path.abspath(args.output)
    report_path = Path(args.report).resolve()
    os.makedirs(os.path.dirname(output), exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)

    source = bpy.data.filepath
    before_objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.name != "Studio_Floor"]
    before_triangles = sum(triangle_count(obj) for obj in before_objects)

    removed = remove_studio_setup()
    resized = downsize_label_textures()
    decimated = apply_decimation()

    root = bpy.data.objects.get("L7SA004A_Assembly_Root")
    if root is None:
        root = bpy.data.objects.new("L7SA004A_Assembly_Root", None)
        bpy.context.scene.collection.objects.link(root)
        for obj in list(bpy.context.scene.objects):
            if obj is not root and obj.parent is None:
                obj.parent = root
    root.scale = (0.001, 0.001, 0.001)
    root["equipment_model"] = "L7SA004A"
    root["manufacturer"] = "LS ELECTRIC"
    root["physical_dimensions_mm"] = "38 x 169 x 173"
    root["asset_role"] = "interactive-wiring-equipment"
    anchors = add_training_anchors(root)

    mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    after_triangles = sum(triangle_count(obj) for obj in mesh_objects)

    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.ops.export_scene.gltf(
        filepath=output,
        export_format="GLB",
        export_extras=True,
        export_cameras=False,
        export_lights=False,
        export_apply=False,
        export_yup=True,
        export_image_format="AUTO",
        export_image_quality=82,
    )
    inlined_images = inline_glb_images(output)

    report = {
        "source": source,
        "output": output,
        "blender_version": bpy.app.version_string,
        "removed": removed,
        "textures_resized": resized,
        "decimation": decimated,
        "anchors": anchors,
        "inlined_images": inlined_images,
        "mesh_objects": len(mesh_objects),
        "triangles_before": before_triangles,
        "triangles_after": after_triangles,
        "triangle_reduction_percent": round((1 - after_triangles / max(before_triangles, 1)) * 100, 2),
        "output_bytes": os.path.getsize(output),
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
