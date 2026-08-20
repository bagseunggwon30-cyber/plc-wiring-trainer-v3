"""Inspect the user-authored L7SA004A Blender file without modifying it."""

import argparse
import json
from pathlib import Path

import bpy
from mathutils import Vector


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", required=True)
    return parser.parse_args(__import__("sys").argv[__import__("sys").argv.index("--") + 1 :])


def rounded(values):
    return [round(float(value), 6) for value in values]


def connected_component_bounds(obj):
    """Return world-space bounds for each connected island of a mesh object."""
    mesh = obj.data
    neighbours = [set() for _ in mesh.vertices]
    for edge in mesh.edges:
        left, right = edge.vertices
        neighbours[left].add(right)
        neighbours[right].add(left)
    remaining = set(range(len(mesh.vertices)))
    result = []
    while remaining:
        seed = remaining.pop()
        stack = [seed]
        component = [seed]
        while stack:
            current = stack.pop()
            attached = neighbours[current] & remaining
            remaining.difference_update(attached)
            stack.extend(attached)
            component.extend(attached)
        points = [obj.matrix_world @ mesh.vertices[index].co for index in component]
        minimum = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
        maximum = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
        result.append({
            "vertices": len(component),
            "min": rounded(minimum),
            "max": rounded(maximum),
            "center": rounded((minimum + maximum) * 0.5),
            "size": rounded(maximum - minimum),
        })
    return sorted(result, key=lambda item: (-item["center"][1], item["center"][2], item["center"][0]))


def main():
    args = parse_args()
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    bounds = []
    object_rows = []
    totals = {"vertices": 0, "edges": 0, "polygons": 0, "triangles": 0}
    for obj in meshes:
        mesh = obj.data
        mesh.calc_loop_triangles()
        row = {
            "name": obj.name,
            "mesh": mesh.name,
            "vertices": len(mesh.vertices),
            "edges": len(mesh.edges),
            "polygons": len(mesh.polygons),
            "triangles": len(mesh.loop_triangles),
            "materials": [slot.material.name if slot.material else None for slot in obj.material_slots],
            "modifiers": [modifier.type for modifier in obj.modifiers],
            "location": rounded(obj.location),
            "dimensions": rounded(obj.dimensions),
            "scale": rounded(obj.scale),
            "hidden_render": bool(obj.hide_render),
        }
        object_rows.append(row)
        if not obj.hide_render:
            bounds.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
        for key in totals:
            totals[key] += row[key]

    if bounds:
        minimum = Vector((min(point.x for point in bounds), min(point.y for point in bounds), min(point.z for point in bounds)))
        maximum = Vector((max(point.x for point in bounds), max(point.y for point in bounds), max(point.z for point in bounds)))
    else:
        minimum = maximum = Vector((0, 0, 0))

    interesting = []
    for obj in bpy.context.scene.objects:
        name = obj.name.upper()
        if any(token in name for token in ("TERM", "ANCHOR", "SOCKET", "PF", "PR", "CN1", "PIN")):
            interesting.append({
                "name": obj.name,
                "type": obj.type,
                "location": rounded(obj.location),
                "world_location": rounded(obj.matrix_world.translation),
                "parent": obj.parent.name if obj.parent else None,
            })

    report = {
        "blender_version": bpy.app.version_string,
        "source": bpy.data.filepath,
        "unit_system": bpy.context.scene.unit_settings.system,
        "unit_scale": bpy.context.scene.unit_settings.scale_length,
        "objects": len(bpy.context.scene.objects),
        "object_types": {kind: sum(obj.type == kind for obj in bpy.context.scene.objects) for kind in sorted({obj.type for obj in bpy.context.scene.objects})},
        "collections": [collection.name for collection in bpy.data.collections],
        "totals": totals,
        "bounds": {"min": rounded(minimum), "max": rounded(maximum), "size": rounded(maximum - minimum)},
        "materials": [
            {
                "name": material.name,
                "use_nodes": bool(material.use_nodes),
                "blend_method": getattr(material, "surface_render_method", None),
            }
            for material in bpy.data.materials
        ],
        "images": [
            {"name": image.name, "size": [int(image.size[0]), int(image.size[1])], "packed": image.packed_file is not None, "filepath": image.filepath}
            for image in bpy.data.images
        ],
        "interesting_nodes": interesting,
        "scene_objects": [
            {
                "name": obj.name,
                "type": obj.type,
                "parent": obj.parent.name if obj.parent else None,
                "location": rounded(obj.location),
                "world_location": rounded(obj.matrix_world.translation),
            }
            for obj in bpy.context.scene.objects
        ],
        "component_bounds": {
            obj.name: connected_component_bounds(obj)
            for obj in meshes
            if obj.name in {"44_CN1_50_Gold_Pins", "48_CN2_15_Gold_Pins", "20_Main_Terminal_Rings"}
        },
        "mesh_objects": sorted(object_rows, key=lambda row: row["triangles"], reverse=True),
    }
    target = Path(args.json)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"report": str(target), "totals": totals, "bounds": report["bounds"], "interesting_nodes": len(interesting)}))


if __name__ == "__main__":
    main()
