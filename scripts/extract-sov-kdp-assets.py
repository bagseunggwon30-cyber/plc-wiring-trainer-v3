#!/usr/bin/env python3
"""Selectively convert local SoV-KDP Unity assets to portable GLB/PNG files.

The source build is only read.  No managed/native assemblies, authentication data,
network configuration, protocol implementation, or user records are copied.

Dependencies (kept outside this repository): UnityPy, trimesh, pygltflib, Pillow.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import trimesh
import UnityPy
from PIL import Image
from trimesh.visual.material import PBRMaterial
from trimesh.visual.texture import TextureVisuals

from sov_glb_assets import inline_lossless_webp_textures, material_fidelity_summary


MAX_SURFACE_TEXTURE_SIZE = 2048
MAX_LABEL_TEXTURE_SIZE = 4096

FIDELITY_TEXTURE_PATTERN = re.compile(
    r"(?:Sticker|Name\s*Plate|Nameplate|Label|Dial|Display|Ruler|Button|Unit|PLC|Power\s*Supply|Hole)",
    re.IGNORECASE,
)

# UnityPy's OBJ exporter mirrors mesh vertices on X.  Conjugating every authored
# local transform by the same basis change keeps the hierarchy in the matching
# right-handed coordinate system instead of scattering nested parts.
UNITY_TO_GLTF_BASIS = np.diag([-1.0, 1.0, 1.0, 1.0])

# Runtime-only sensing and placement helpers have visible debug meshes in the
# serialized scene.  Unity hides these during normal operation; they must not be
# presented as pieces of the machine in Electron.
HELPER_VISUAL_PATTERN = re.compile(
    r"(?:Worker|Special|Sensor|Senser|Create|Remove|Supply|Drill|Lift|Unloading|Emission)"
    r"(?:Area|Point|DragPoint)|WorkerDragPoints|Empty$",
    re.IGNORECASE,
)


PREFAB_TARGETS = {
    "PF_PLC_MODULE": "mitsubishi-q-plc-module.glb",
    "PF_DOUBLE_ACT_CYL": "double-acting-cylinder.glb",
    "PF_5P2W_SINGLE_SOL": "valve-5-2-single.glb",
    "PF_5P2W_DOUBLE_SOL": "valve-5-2-double.glb",
    "PF_SERVICE_UNIT": "service-unit.glb",
    "PF_AIR_DISTRIBUTOR": "air-distributor.glb",
    "PF_SPEED_CONTROLLER": "speed-controller.glb",
    "PF_PHOTO_DIRECT_NPN": "photo-sensor-npn.glb",
    "PF_PHOTO_DIRECT_PNP": "photo-sensor-pnp.glb",
    "PF_INDUCTIVE_NPN": "inductive-sensor-npn.glb",
    "PF_INDUCTIVE_PNP": "inductive-sensor-pnp.glb",
    "PF_CAPACITIVE_NPN": "capacitive-sensor-npn.glb",
    "PF_CAPACITIVE_PNP": "capacitive-sensor-pnp.glb",
    "PF_LIMIT_SWITCH_LEFT": "limit-switch-left.glb",
    "PF_LIMIT_SWITCH_RIGHT": "limit-switch-right.glb",
    "PF_RELAY": "relay-module.glb",
    "PF_TIMER_BOX": "timer-box.glb",
    "Digital Counter Unit_OP": "counter-unit.glb",
    "PF_COUNT_BOX": "counter-box.glb",
    "SSCNETIII_AMP_HEAD": "sscnetiii-amp-head.glb",
    "PF_RULER": "ruler.glb",
    "BPlugBlack": "banana-plug-black.glb",
    "PF_BLUE_STEEL": "workblock-steel-blue.glb",
    "PF_ORANGE_PP": "workblock-plastic-orange.glb",
    "PF_SMPS": "smps.glb",
    "PF_BUZZER_LAMP": "buzzer-lamp.glb",
    "PF_SWITCH_BOX": "switch-box.glb",
    "STWorker": "workpiece-steel.glb",
    "PPWorker": "workpiece-plastic.glb",
}

# These two authored work blocks use a unit cube with the physical dimensions
# stored on the prefab root.  Root position belongs to the Unity palette and
# must stay stripped, while its 60 x 80 x 40 mm scale is part of the asset.
ROOT_SCALE_TARGETS = frozenset({"PF_BLUE_STEEL", "PF_ORANGE_PP"})

# Renderable Unity roots that were inspected but are not independent equipment.
# Keeping this in the generated manifest makes the selective boundary auditable
# without packaging duplicated variants or runtime-only display helpers.
GEOMETRY_EXCLUSIONS = (
    {"sourceFile": "sharedassets0.assets", "pathId": 1081, "root": "STWorker_Flat", "reason": "duplicate-scale-variant"},
    {"sourceFile": "sharedassets0.assets", "pathId": 1082, "root": "PPWorker_Plat", "reason": "duplicate-scale-variant"},
    {"sourceFile": "sharedassets0.assets", "pathId": 1001, "root": "FND_Mesh", "reason": "internal-display-part"},
    {"sourceFile": "sharedassets0.assets", "pathId": 793, "root": "Analog Count Text", "reason": "internal-display-part"},
    {"sourceFile": "level0", "pathId": 719, "root": "Emission Box", "reason": "runtime-helper-visual"},
    {"sourceFile": "level0", "pathId": 1129, "root": "Maker Box", "reason": "runtime-helper-visual"},
)

KNOWN_LIMITATIONS = (
    {
        "code": "SKINNED_FND_NOT_EXPORTED",
        "affects": ["timer-box.glb", "counter-box.glb", "servo-amplifier.glb", "mps-complete-station.glb", "servo2-workshop.glb"],
        "status": "partial-runtime-overlay",
        "detail": "Skinned seven-segment meshes remain absent from static GLBs. The 24V discrete I/O bench supplies deterministic CanvasTexture overlays for timer-box.glb and counter-box.glb; servo and MPS displays remain pending.",
    },
)

RUNTIME_OVERLAYS = (
    {
        "code": "TIMER_COUNTER_FND_OVERLAY_V1",
        "models": ["timer-box.glb", "counter-box.glb", "counter-unit.glb"],
        "scope": "discrete-lab",
        "owner": "src/ui/automation-labs.js",
        "status": "implemented",
        "detail": "Displays deterministic simulated timer PV, counter PV and counter preset values. It is a runtime teaching overlay, not extracted manufacturer geometry.",
    },
)

# Equipment already present inside the minimal lab roots is not exported again.
# Only the standalone servo amplifier remains a useful scene-level asset.
SCENE_TARGETS = {
    "ServoModule Variant": "servo-amplifier.glb",
}

# Scene GameObject path IDs are used for duplicate names such as WorldObject.
# Export only the actual training equipment.  The classroom scene contains more
# than a hundred chairs, desks, walls, pictures and decorative props per lab;
# those do not affect simulation and are deliberately excluded from the package.
SCENE_PATH_TARGETS = {
    95: ("Tower lamp", "tower-lamp.glb"),
    1625: ("Servo motion kit", "servo2-workshop.glb"),
    283: ("MPS equipment", "mps-complete-station.glb"),
}

TEXTURE_PATTERNS = (
    r"^Q03UDVCPU_Sticker$",
    r"^QD75MH2_Sticker$",
    r"^Q61P(?:_OP)?_Sticker$",
    r"^Servo(?: Panel Box)?_Sticker$",
    r"^PLC$",
    r"Double Acting Cylinder",
    r"5_2-Way Solenoid Valve",
    r"Air (?:regulator|Distributor)",
    r"Photo.*(?:NPN|PNP)",
)


@dataclass
class ExportedNode:
    name: str
    mesh_name: str
    source_file: str
    source_path_id: int
    source_game_object_path_id: int
    material: str | None
    texture: str | None


def component(game_object: Any, class_name: str) -> Any | None:
    for pair in getattr(game_object, "m_Component", ()):  # Unity component pointer pairs
        try:
            value = pair.component.read()
        except Exception:
            continue
        if value.__class__.__name__ == class_name:
            return value
    return None


def vec3(value: Any, default: tuple[float, float, float]) -> np.ndarray:
    if value is None:
        return np.array(default, dtype=float)
    return np.array(
        [float(getattr(value, "x", default[0])), float(getattr(value, "y", default[1])), float(getattr(value, "z", default[2]))],
        dtype=float,
    )


def local_matrix(transform: Any) -> np.ndarray:
    position = vec3(getattr(transform, "m_LocalPosition", None), (0.0, 0.0, 0.0))
    scale = vec3(getattr(transform, "m_LocalScale", None), (1.0, 1.0, 1.0))
    rotation = getattr(transform, "m_LocalRotation", None)
    if rotation is None:
        quaternion = [1.0, 0.0, 0.0, 0.0]
    else:
        quaternion = [
            float(getattr(rotation, "w", 1.0)),
            float(getattr(rotation, "x", 0.0)),
            float(getattr(rotation, "y", 0.0)),
            float(getattr(rotation, "z", 0.0)),
        ]
    matrix = trimesh.transformations.quaternion_matrix(quaternion)
    matrix[:3, :3] = matrix[:3, :3] @ np.diag(scale)
    matrix[:3, 3] = position
    return UNITY_TO_GLTF_BASIS @ matrix @ UNITY_TO_GLTF_BASIS


def safe_name(value: str) -> str:
    cleaned = re.sub(r"[^0-9A-Za-z_.-]+", "-", value.strip()).strip("-.")
    return cleaned or "unnamed"


def _rgba(color: Any | None, fallback: tuple[int, int, int, int] = (126, 145, 156, 255)) -> list[int]:
    if color is None:
        return list(fallback)
    values = [getattr(color, channel, 1.0) for channel in ("r", "g", "b", "a")]
    return [int(round(max(0.0, min(1.0, float(value))) * 255)) for value in values]


def _texture_image(
    pointer: Any | None,
    texture_cache: dict[tuple[str, int], Any],
    *,
    maximum_size: int,
) -> tuple[str | None, Any | None]:
    if pointer is None or not getattr(pointer, "path_id", 0):
        return None, None
    try:
        texture = pointer.read()
        reader = texture.object_reader
        cache_key = (str(getattr(reader.assets_file, "name", "unknown")), int(reader.path_id))
        if cache_key not in texture_cache:
            texture_cache[cache_key] = texture.image.convert("RGBA")
        image = texture_cache[cache_key].copy()
        image.thumbnail((maximum_size, maximum_size), Image.Resampling.LANCZOS)
        return str(getattr(texture, "m_Name", "Texture")), image
    except Exception:
        return None, None


def _normal_texture(image: Any | None) -> Any | None:
    if image is None:
        return None
    source = np.asarray(image.convert("RGBA"), dtype=np.float32)
    x = source[:, :, 3] / 255.0 * 2.0 - 1.0
    y = source[:, :, 1] / 255.0 * 2.0 - 1.0
    z = np.sqrt(np.maximum(0.0, 1.0 - x * x - y * y))
    converted = np.empty_like(source, dtype=np.uint8)
    converted[:, :, 0] = np.clip((x * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)
    converted[:, :, 1] = np.clip((y * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)
    converted[:, :, 2] = np.clip(z * 255.0, 0, 255).astype(np.uint8)
    converted[:, :, 3] = 255
    return Image.fromarray(converted, "RGBA")


def _metallic_roughness_texture(image: Any | None) -> Any | None:
    if image is None:
        return None
    source = np.asarray(image.convert("RGBA"), dtype=np.uint8)
    converted = np.full_like(source, 255)
    converted[:, :, 1] = 255 - source[:, :, 3]
    converted[:, :, 2] = source[:, :, 0]
    return Image.fromarray(converted, "RGBA")


def _occlusion_texture(image: Any | None) -> Any | None:
    if image is None:
        return None
    source = np.asarray(image.convert("RGBA"), dtype=np.uint8)
    converted = np.empty_like(source)
    converted[:, :, 0] = source[:, :, 1]
    converted[:, :, 1] = source[:, :, 1]
    converted[:, :, 2] = source[:, :, 1]
    converted[:, :, 3] = 255
    return Image.fromarray(converted, "RGBA")


def material_info(
    renderer: Any | None,
    material_index: int,
    texture_cache: dict[tuple[str, int], Any],
) -> dict[str, Any]:
    info: dict[str, Any] = {
        "name": None,
        "rgba": [126, 145, 156, 255],
        "texture_name": None,
        "texture_image": None,
        "texture_scale": [1.0, 1.0],
        "texture_offset": [0.0, 0.0],
        "normal_image": None,
        "metallic_roughness_image": None,
        "occlusion_image": None,
        "emissive_image": None,
        "metallic": 0.0,
        "roughness": 0.65,
        "emissive": [0.0, 0.0, 0.0],
        "alpha_mode": "OPAQUE",
        "alpha_cutoff": None,
        "double_sided": False,
    }
    pointers = list(getattr(renderer, "m_Materials", ()) or ()) if renderer is not None else []
    if not pointers:
        return info
    pointer = pointers[min(max(0, material_index), len(pointers) - 1)]
    if not getattr(pointer, "path_id", 0):
        return info
    try:
        material = pointer.read()
    except Exception:
        return info

    info["name"] = str(getattr(material, "m_Name", "Material"))
    saved = getattr(material, "m_SavedProperties", None)
    colors = dict(getattr(saved, "m_Colors", ()) or ())
    floats = dict(getattr(saved, "m_Floats", ()) or ())
    info["rgba"] = _rgba(colors.get("_BaseColor") or colors.get("_Color"))
    info["metallic"] = max(0.0, min(1.0, float(floats.get("_Metallic", 0.0))))
    smoothness = max(0.0, min(1.0, float(floats.get("_Smoothness", floats.get("_Glossiness", 0.35)))))
    info["roughness"] = 1.0 - smoothness
    emission = colors.get("_EmissionColor")
    if emission is not None:
        info["emissive"] = [
            max(0.0, min(1.0, float(getattr(emission, channel, 0.0))))
            for channel in ("r", "g", "b")
        ]

    mode = float(floats.get("_Mode", 0.0))
    surface = float(floats.get("_Surface", 0.0))
    alpha_clip = float(floats.get("_AlphaClip", floats.get("_AlphaClipEnable", 0.0)))
    if mode == 1.0 or alpha_clip > 0.0:
        info["alpha_mode"] = "MASK"
        info["alpha_cutoff"] = max(0.0, min(1.0, float(floats.get("_Cutoff", 0.5))))
    elif mode >= 2.0 or surface >= 1.0 or info["rgba"][3] < 255:
        info["alpha_mode"] = "BLEND"
    info["double_sided"] = float(floats.get("_Cull", 2.0)) == 0.0

    texture_environments = dict(getattr(saved, "m_TexEnvs", ()) or ())
    texture_pointer = None
    texture_name = None
    for key in ("_BaseMap", "_MainTex"):
        environment = texture_environments.get(key)
        candidate = getattr(environment, "m_Texture", None)
        if candidate is not None and getattr(candidate, "path_id", 0):
            texture_pointer = candidate
            scale_value = getattr(environment, "m_Scale", None)
            offset_value = getattr(environment, "m_Offset", None)
            info["texture_scale"] = [
                float(getattr(scale_value, "x", 1.0)),
                float(getattr(scale_value, "y", 1.0)),
            ]
            info["texture_offset"] = [
                float(getattr(offset_value, "x", 0.0)),
                float(getattr(offset_value, "y", 0.0)),
            ]
            break
    if texture_pointer is not None:
        try:
            texture_name = str(getattr(texture_pointer.read(), "m_Name", "Texture"))
        except Exception:
            texture_name = None
        label_texture = FIDELITY_TEXTURE_PATTERN.search(f"{info['name']} {texture_name or ''}") is not None
        info["texture_name"], info["texture_image"] = _texture_image(
            texture_pointer,
            texture_cache,
            maximum_size=MAX_LABEL_TEXTURE_SIZE if label_texture else MAX_SURFACE_TEXTURE_SIZE,
        )

    slot_images: dict[str, Any | None] = {}
    for slot in ("_BumpMap", "_MetallicGlossMap", "_OcclusionMap", "_EmissionMap"):
        environment = texture_environments.get(slot)
        _, slot_images[slot] = _texture_image(
            getattr(environment, "m_Texture", None),
            texture_cache,
            maximum_size=MAX_SURFACE_TEXTURE_SIZE,
        )
    info["normal_image"] = _normal_texture(slot_images["_BumpMap"])
    info["metallic_roughness_image"] = _metallic_roughness_texture(slot_images["_MetallicGlossMap"])
    info["occlusion_image"] = _occlusion_texture(slot_images["_OcclusionMap"])
    info["emissive_image"] = slot_images["_EmissionMap"]
    return info


def _load_obj_part(obj_text: str) -> trimesh.Trimesh:
    """Load one Unity OBJ material group without losing indexed UVs/normals.

    ``trimesh.load_obj`` retains every definition preceding a split group. For
    Unity meshes that means material 2 can inherit thousands of unused vertices
    from material 1; its independent vt/vn indices are then collapsed and the
    texture silently disappears. Re-index the exact v/vt/vn tuples referenced
    by this group's faces instead.
    """

    positions: list[tuple[float, float, float]] = []
    texture_coordinates: list[tuple[float, float]] = []
    normals: list[tuple[float, float, float]] = []
    face_tokens: list[list[str]] = []
    for line in obj_text.splitlines():
        values = line.split()
        if not values:
            continue
        if values[0] == "v" and len(values) >= 4:
            positions.append(tuple(float(value) for value in values[1:4]))
        elif values[0] == "vt" and len(values) >= 3:
            texture_coordinates.append(tuple(float(value) for value in values[1:3]))
        elif values[0] == "vn" and len(values) >= 4:
            normals.append(tuple(float(value) for value in values[1:4]))
        elif values[0] == "f" and len(values) >= 4:
            # UnityPy emits triangles, but fan triangulation keeps the parser
            # safe for an authored quad without changing winding.
            for index in range(2, len(values) - 1):
                face_tokens.append([values[1], values[index], values[index + 1]])
    if not face_tokens:
        raise TypeError("OBJ material group has no faces")

    def obj_index(raw: str, count: int) -> int | None:
        if not raw:
            return None
        value = int(raw)
        return value - 1 if value > 0 else count + value

    vertices: list[tuple[float, float, float]] = []
    uvs: list[tuple[float, float]] = []
    authored_normals: list[tuple[float, float, float]] = []
    faces: list[list[int]] = []
    remap: dict[tuple[int, int | None, int | None], int] = {}
    has_uv = True
    has_normals = True
    for source_face in face_tokens:
        target_face: list[int] = []
        for token in source_face:
            indices = token.split("/")
            vertex_index = obj_index(indices[0], len(positions))
            # UnityPy can emit `v/vt/vn`-shaped tokens even when the source
            # mesh has no UV channel (and therefore writes no `vt` records).
            uv_index = obj_index(indices[1], len(texture_coordinates)) if len(indices) > 1 and texture_coordinates else None
            normal_index = obj_index(indices[2], len(normals)) if len(indices) > 2 and normals else None
            if vertex_index is None:
                raise TypeError(f"OBJ face token has no vertex index: {token}")
            key = (vertex_index, uv_index, normal_index)
            target_index = remap.get(key)
            if target_index is None:
                target_index = len(vertices)
                remap[key] = target_index
                vertices.append(positions[vertex_index])
                if uv_index is None:
                    has_uv = False
                    uvs.append((0.0, 0.0))
                else:
                    uvs.append(texture_coordinates[uv_index])
                if normal_index is None:
                    has_normals = False
                    authored_normals.append((0.0, 0.0, 1.0))
                else:
                    authored_normals.append(normals[normal_index])
            target_face.append(target_index)
        faces.append(target_face)

    visual = TextureVisuals(uv=np.asarray(uvs, dtype=float)) if has_uv else None
    loaded = trimesh.Trimesh(
        vertices=np.asarray(vertices, dtype=float),
        faces=np.asarray(faces, dtype=np.int64),
        vertex_normals=np.asarray(authored_normals, dtype=float) if has_normals else None,
        visual=visual,
        process=False,
    )
    if has_normals:
        loaded.metadata["_sov_authored_normals"] = np.asarray(authored_normals, dtype=float)
    return loaded


def _split_obj_submeshes(obj_text: str) -> list[tuple[int, trimesh.Trimesh]]:
    """Split UnityPy's OBJ `g Mesh_0` chunks so each Unity material survives."""
    definitions = [line for line in obj_text.splitlines() if line.startswith(("v ", "vt ", "vn "))]
    groups: list[tuple[str, list[str]]] = []
    current: tuple[str, list[str]] | None = None
    for line in obj_text.splitlines():
        if line.startswith("g "):
            current = (line[2:].strip(), [])
            groups.append(current)
        elif line.startswith("f ") and current is not None:
            current[1].append(line)
    populated = [(name, faces) for name, faces in groups if faces]
    if len(populated) <= 1:
        match = re.search(r"(?:^|_)Mesh_(\d+)$", populated[0][0]) if populated else None
        return [(int(match.group(1)) if match else 0, _load_obj_part(obj_text))]
    result: list[tuple[int, trimesh.Trimesh]] = []
    for fallback_index, (name, faces) in enumerate(populated):
        match = re.search(r"(?:^|_)Mesh_(\d+)$", name)
        material_index = int(match.group(1)) if match else fallback_index
        result.append((material_index, _load_obj_part("\n".join([*definitions, f"g {name}", *faces, ""]))))
    return result


def mesh_from_pointer(
    pointer: Any,
    cache: dict[tuple[str, int], list[tuple[int, trimesh.Trimesh]]],
) -> tuple[list[tuple[int, trimesh.Trimesh]], Any]:
    source = pointer.read()
    reader = source.object_reader
    key = (str(getattr(reader.assets_file, "name", "unknown")), int(reader.path_id))
    if key not in cache:
        cache[key] = _split_obj_submeshes(source.export())
    return [(material_index, geometry.copy()) for material_index, geometry in cache[key]], source


def apply_material(geometry: trimesh.Trimesh, info: dict[str, Any]) -> None:
    image = info.get("texture_image")
    uv = getattr(geometry.visual, "uv", None)
    valid_uv = uv is not None and len(uv) == len(geometry.vertices)
    transformed_uv = None
    if valid_uv:
        transformed_uv = np.asarray(uv, dtype=float).copy()
        scale = np.asarray(info.get("texture_scale", [1.0, 1.0]), dtype=float)
        offset = np.asarray(info.get("texture_offset", [0.0, 0.0]), dtype=float)
        transformed_uv = transformed_uv * scale + offset
        # Some Unity submeshes leave UV entries undefined for vertices that do
        # not sample a texture. glTF requires finite accessor values.
        transformed_uv = np.nan_to_num(transformed_uv, nan=0.0, posinf=0.0, neginf=0.0)
    material = PBRMaterial(
        name=info.get("name") or "Material",
        baseColorFactor=info["rgba"],
        baseColorTexture=image if image is not None and valid_uv else None,
        metallicFactor=info["metallic"],
        roughnessFactor=info["roughness"],
        normalTexture=info.get("normal_image"),
        metallicRoughnessTexture=info.get("metallic_roughness_image"),
        occlusionTexture=info.get("occlusion_image"),
        emissiveTexture=info.get("emissive_image"),
        emissiveFactor=info.get("emissive", [0.0, 0.0, 0.0]),
        alphaMode=info["alpha_mode"],
        alphaCutoff=info.get("alpha_cutoff"),
        doubleSided=info.get("double_sided", False),
    )
    # Replacing the visual is essential.  Assigning vertex_colors onto an
    # existing TextureVisuals object leaves trimesh's generic grey texture in the
    # export and discards the authored Unity material colour.
    geometry.visual = TextureVisuals(uv=transformed_uv, material=material)


def export_subtree(root_game_object: Any, destination: Path, *, root_transform_mode: str = "identity") -> dict[str, Any]:
    root_transform = component(root_game_object, "Transform")
    if root_transform is None:
        raise ValueError(f"{root_game_object.m_Name}: Transform not found")
    if root_transform_mode not in {"identity", "scale-only"}:
        raise ValueError(f"Unsupported root transform mode: {root_transform_mode}")

    scene = trimesh.Scene()
    mesh_cache: dict[tuple[str, int], list[tuple[int, trimesh.Trimesh]]] = {}
    texture_cache: dict[tuple[str, int], Any] = {}
    nodes: list[ExportedNode] = []
    transform_nodes = 0

    def walk(transform: Any, parent_node: str, is_root: bool = False) -> None:
        nonlocal transform_nodes
        game_object = transform.m_GameObject.read()
        # Inactive Unity variants contain alternate sockets, covers, and debug
        # meshes. Exporting them together makes the equipment look exploded.
        # Lab roots are mutually disabled by the page manager and activated when
        # selected.  Treat the explicitly selected root as active while still
        # pruning inactive authored variants below it.
        if not is_root and not bool(getattr(game_object, "m_IsActive", True)):
            return

        game_object_reader = game_object.object_reader
        game_object_path_id = int(game_object_reader.path_id)
        node_name = f"{safe_name(str(game_object.m_Name))}__go{game_object_path_id}"
        if is_root and root_transform_mode == "scale-only":
            root_scale = vec3(getattr(transform, "m_LocalScale", None), (1.0, 1.0, 1.0))
            matrix = np.diag([root_scale[0], root_scale[1], root_scale[2], 1.0])
        else:
            matrix = np.eye(4) if is_root else local_matrix(transform)
        scene.graph.update(frame_to=node_name, frame_from=parent_node, matrix=matrix)
        transform_nodes += 1

        mesh_filter = component(game_object, "MeshFilter")
        skinned_renderer = component(game_object, "SkinnedMeshRenderer")
        renderer = component(game_object, "MeshRenderer") or skinned_renderer
        # FND digits are skinned meshes. Exporting their unbaked bind-pose mesh as
        # a static child produces detached segments. They remain a documented
        # limitation until a proper glTF skin exporter or runtime overlay exists.
        mesh_pointer = getattr(mesh_filter, "m_Mesh", None) if mesh_filter is not None else None
        renderer_enabled = renderer is not None and bool(getattr(renderer, "m_Enabled", True))
        if renderer_enabled and mesh_pointer is not None and getattr(mesh_pointer, "path_id", 0):
            try:
                geometries, source_mesh = mesh_from_pointer(mesh_pointer, mesh_cache)
                source_reader = source_mesh.object_reader
                for material_index, geometry in geometries:
                    info = material_info(renderer, material_index, texture_cache)
                    if HELPER_VISUAL_PATTERN.search(str(game_object.m_Name)) or HELPER_VISUAL_PATTERN.search(str(source_mesh.m_Name)) or HELPER_VISUAL_PATTERN.search(str(info.get("name") or "")):
                        continue
                    authored_normals = geometry.metadata.pop("_sov_authored_normals", None)
                    apply_material(geometry, info)
                    if authored_normals is not None:
                        authored_normals = np.asarray(authored_normals, dtype=float)
                        if authored_normals.shape == np.asarray(geometry.vertices).shape:
                            geometry.vertex_normals = authored_normals
                    geometry_node_name = f"{node_name}__mesh{material_index}"
                    geometry_name = f"{safe_name(str(source_mesh.m_Name))}__{int(source_reader.path_id)}_{material_index}"
                    scene.add_geometry(
                        geometry,
                        node_name=geometry_node_name,
                        geom_name=geometry_name,
                        parent_node_name=node_name,
                        transform=np.eye(4),
                    )
                    nodes.append(
                        ExportedNode(
                            name=str(game_object.m_Name),
                            mesh_name=str(source_mesh.m_Name),
                            source_file=str(getattr(source_reader.assets_file, "name", "unknown")),
                            source_path_id=int(source_reader.path_id),
                            source_game_object_path_id=game_object_path_id,
                            material=info.get("name"),
                            texture=info.get("texture_name"),
                        )
                    )
            except Exception as error:
                print(f"  skip mesh {game_object.m_Name!r}: {error}")
        for child_pointer in getattr(transform, "m_Children", ()):
            try:
                walk(child_pointer.read(), node_name)
            except Exception as error:
                print(f"  skip child under {game_object.m_Name!r}: {error}")

    walk(root_transform, scene.graph.base_frame, True)
    if not nodes:
        raise ValueError(f"{root_game_object.m_Name}: no exportable MeshFilter found")

    # Rotate the asset only through its own authored hierarchy. Handedness is left
    # untouched so the consuming Three.js scene can choose its desired convention.
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(scene.export(file_type="glb", extension_webp=False, include_normals=True))
    inlined_texture_count = inline_lossless_webp_textures(destination)
    bounds = np.asarray(scene.bounds, dtype=float)
    return {
        "file": destination.name,
        "root": str(root_game_object.m_Name),
        "sourceGameObjectPathId": int(root_game_object.object_reader.path_id),
        "rootTransformMode": root_transform_mode,
        "transformNodeCount": transform_nodes,
        "embeddedTextureFormat": "webp-lossless",
        "embeddedTextureTransport": "data-uri" if inlined_texture_count else "none",
        "embeddedTextureMaxSize": MAX_LABEL_TEXTURE_SIZE,
        "surfaceTextureMaxSize": MAX_SURFACE_TEXTURE_SIZE,
        "nodeCount": len(nodes),
        "triangleCount": int(sum(len(geometry.faces) for geometry in scene.geometry.values())),
        "bounds": bounds.round(6).tolist() if bounds.shape == (2, 3) else None,
        "bytes": destination.stat().st_size,
        "sha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
        "nodes": [node.__dict__ for node in nodes],
        "materialFidelity": material_fidelity_summary(destination),
    }


def find_game_objects(environment: Any, source_file: str, names: Iterable[str]) -> dict[str, Any]:
    wanted = set(names)
    found: dict[str, Any] = {}
    for obj in environment.objects:
        if obj.type.name != "GameObject" or str(getattr(obj.assets_file, "name", "")) != source_file:
            continue
        try:
            game_object = obj.read()
        except Exception:
            continue
        name = str(getattr(game_object, "m_Name", ""))
        if name in wanted and name not in found:
            found[name] = game_object
    return found


def find_game_objects_by_path(environment: Any, source_file: str, path_ids: Iterable[int]) -> dict[int, Any]:
    wanted = {int(path_id) for path_id in path_ids}
    found: dict[int, Any] = {}
    for obj in environment.objects:
        if obj.type.name != "GameObject" or str(getattr(obj.assets_file, "name", "")) != source_file:
            continue
        if int(obj.path_id) not in wanted:
            continue
        try:
            found[int(obj.path_id)] = obj.read()
        except Exception:
            continue
    return found


def texture_matches(name: str) -> bool:
    return any(re.search(pattern, name, re.IGNORECASE) for pattern in TEXTURE_PATTERNS)


def export_textures(environment: Any, output_dir: Path) -> list[dict[str, Any]]:
    output_dir.mkdir(parents=True, exist_ok=True)
    exported: list[dict[str, Any]] = []
    used_names: set[str] = set()
    for obj in environment.objects:
        if obj.type.name != "Texture2D":
            continue
        try:
            texture = obj.read()
            original_name = str(getattr(texture, "m_Name", ""))
            if not texture_matches(original_name):
                continue
            stem = safe_name(original_name).lower()
            filename = f"{stem}.png"
            if filename in used_names:
                filename = f"{stem}-{obj.path_id}.png"
            image = texture.image
            destination = output_dir / filename
            image.save(destination, "PNG", optimize=True)
            used_names.add(filename)
            exported.append(
                {
                    "file": filename,
                    "name": original_name,
                    "sourceFile": str(getattr(obj.assets_file, "name", "unknown")),
                    "sourcePathId": int(obj.path_id),
                    "width": int(image.width),
                    "height": int(image.height),
                    "bytes": destination.stat().st_size,
                    "sha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
                }
            )
            print(f"texture {original_name!r} -> {destination.name}")
        except Exception as error:
            print(f"  skip texture path {obj.path_id}: {error}")
    return exported


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path, help="SoV-KDP_Data directory (read-only input)")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("assets/imported/sov-kdp"),
        help="Output directory in this project",
    )
    parser.add_argument("--skip-textures", action="store_true")
    parser.add_argument(
        "--only-model",
        action="append",
        default=[],
        metavar="FILENAME",
        help="Rebuild only the named GLB; may be repeated and preserves other manifest entries",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source = args.source.resolve()
    output = args.output.resolve()
    selected_models = {str(value) for value in args.only_model}
    known_models = set(PREFAB_TARGETS.values()) | set(SCENE_TARGETS.values()) | {value[1] for value in SCENE_PATH_TARGETS.values()}
    unknown_models = selected_models - known_models
    if unknown_models:
        raise SystemExit(f"Unknown --only-model target(s): {', '.join(sorted(unknown_models))}")
    include_model = lambda filename: not selected_models or filename in selected_models
    if not source.is_dir() or not (source / "sharedassets0.assets").is_file() or not (source / "level0").is_file():
        raise SystemExit(f"Not a supported SoV-KDP_Data directory: {source}")
    if output == source or source in output.parents:
        raise SystemExit("Output must not be inside the source Unity build")

    print(f"loading read-only Unity data: {source}")
    environment = UnityPy.load(str(source))
    models_dir = output / "models"
    manifest: dict[str, Any] = {
        "schemaVersion": 1,
        "sourceProduct": "SoV-KDP 1.1.9K",
        "sourceUnityVersion": "2021.3.20f1",
        "extractedAt": datetime.now(timezone.utc).isoformat(),
        "sourceDirectoryName": source.parent.name,
        "policy": "selective-assets-only",
        "excluded": [
            "managed and native code",
            "authentication and account data",
            "dongle and licence checks",
            "network endpoints and protocol implementations",
            "saved user records",
        ],
        "models": [],
        "textures": [],
        "geometryExclusions": [dict(item) for item in GEOMETRY_EXCLUSIONS],
        "knownLimitations": [dict(item) for item in KNOWN_LIMITATIONS],
        "runtimeOverlays": [dict(item) for item in RUNTIME_OVERLAYS],
        "materialFidelity": {
            "version": 2,
            "textureEncoding": "lossless-webp",
            "labelTextureMaxSize": MAX_LABEL_TEXTURE_SIZE,
            "surfaceTextureMaxSize": MAX_SURFACE_TEXTURE_SIZE,
            "preservesAlphaClip": True,
            "preservesAuthoredNormals": True,
            "preservesAuxiliaryMaps": True,
        },
    }

    prefabs = find_game_objects(environment, "sharedassets0.assets", PREFAB_TARGETS)
    scene_objects = find_game_objects(environment, "level0", SCENE_TARGETS)
    scene_path_objects = find_game_objects_by_path(environment, "level0", SCENE_PATH_TARGETS)
    missing = sorted((set(PREFAB_TARGETS) - set(prefabs)) | (set(SCENE_TARGETS) - set(scene_objects)))
    missing_paths = sorted(set(SCENE_PATH_TARGETS) - set(scene_path_objects))
    if missing:
        print("warning: targets not found:", ", ".join(missing))
    if missing_paths:
        print("warning: scene path targets not found:", ", ".join(map(str, missing_paths)))

    for target_name, filename in PREFAB_TARGETS.items():
        if target_name not in prefabs or not include_model(filename):
            continue
        print(f"model {target_name!r} -> {filename}")
        root_transform_mode = "scale-only" if target_name in ROOT_SCALE_TARGETS else "identity"
        manifest["models"].append(export_subtree(prefabs[target_name], models_dir / filename, root_transform_mode=root_transform_mode))
    for target_name, filename in SCENE_TARGETS.items():
        if target_name not in scene_objects or not include_model(filename):
            continue
        print(f"model {target_name!r} -> {filename}")
        manifest["models"].append(export_subtree(scene_objects[target_name], models_dir / filename))
    for path_id, (target_label, filename) in SCENE_PATH_TARGETS.items():
        if path_id not in scene_path_objects or not include_model(filename):
            continue
        game_object = scene_path_objects[path_id]
        print(f"model {target_label!r} path {path_id} -> {filename}")
        manifest["models"].append(export_subtree(game_object, models_dir / filename))

    manifest_path = output / "manifest.json"
    previous_manifest = None
    if selected_models and manifest_path.is_file():
        previous_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        rebuilt = manifest["models"]
        # Do not keep files removed from the allow-list.  This lets a partial
        # rebuild also retire obsolete scenery-only exports from the manifest.
        manifest["models"] = [
            entry
            for entry in previous_manifest.get("models", [])
            if entry.get("file") not in selected_models and entry.get("file") in known_models
        ] + rebuilt

    if not args.skip_textures:
        manifest["textures"] = export_textures(environment, output / "textures")
    # GLBs already embed the authored textures as WebP.  A --skip-textures
    # package is intentionally self-contained and must not retain stale PNG
    # duplicates from an earlier extraction.

    output.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"manifest -> {manifest_path}")
    print(f"done: {len(manifest['models'])} models, {len(manifest['textures'])} textures")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
