#!/usr/bin/env python3
"""Normalize imported SoV GLBs for deterministic offline browser loading.

Three.js normally exposes bufferView-backed images through temporary ``blob:``
URLs.  Some offline Electron/browser security contexts reject those URLs even
when the same WebP bytes are valid.  This module moves only the embedded WebP
payloads into ``data:`` URIs while preserving geometry, node hierarchy and
material assignments.  The now-unused image bufferViews are reduced to four
padding bytes so the package does not retain a second texture copy.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import struct
from io import BytesIO
from pathlib import Path
from typing import Any

from PIL import Image


GLB_MAGIC = b"glTF"
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942


def _parse_glb(data: bytes) -> tuple[dict[str, Any], bytes]:
    if len(data) < 28 or data[:4] != GLB_MAGIC:
        raise ValueError("not a GLB 2.0 file")
    version, declared_length = struct.unpack_from("<II", data, 4)
    if version != 2 or declared_length != len(data):
        raise ValueError("invalid GLB header")

    json_length, json_type = struct.unpack_from("<II", data, 12)
    if json_type != JSON_CHUNK:
        raise ValueError("GLB JSON chunk is missing")
    json_start = 20
    json_end = json_start + json_length
    document = json.loads(data[json_start:json_end].rstrip(b"\x00 ").decode("utf-8"))

    bin_header = json_end
    if bin_header + 8 > len(data):
        raise ValueError("GLB BIN chunk is missing")
    bin_length, bin_type = struct.unpack_from("<II", data, bin_header)
    if bin_type != BIN_CHUNK or bin_header + 8 + bin_length > len(data):
        raise ValueError("invalid GLB BIN chunk")
    return document, data[bin_header + 8 : bin_header + 8 + bin_length]


def _buffer_view_references(value: Any, path: tuple[Any, ...] = ()) -> dict[int, list[tuple[Any, ...]]]:
    references: dict[int, list[tuple[Any, ...]]] = {}

    def visit(node: Any, current: tuple[Any, ...]) -> None:
        if isinstance(node, dict):
            for key, child in node.items():
                child_path = current + (key,)
                if key == "bufferView" and isinstance(child, int):
                    references.setdefault(child, []).append(child_path)
                else:
                    visit(child, child_path)
        elif isinstance(node, list):
            for index, child in enumerate(node):
                visit(child, current + (index,))

    visit(value, path)
    return references


def _encode_glb(document: dict[str, Any], binary: bytes) -> bytes:
    json_bytes = json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    json_bytes += b" " * ((-len(json_bytes)) % 4)
    binary += b"\x00" * ((-len(binary)) % 4)
    total = 12 + 8 + len(json_bytes) + 8 + len(binary)
    return b"".join(
        (
            GLB_MAGIC,
            struct.pack("<II", 2, total),
            struct.pack("<II", len(json_bytes), JSON_CHUNK),
            json_bytes,
            struct.pack("<II", len(binary), BIN_CHUNK),
            binary,
        )
    )


def _lossless_webp(payload: bytes) -> bytes:
    image = Image.open(BytesIO(payload)).convert("RGBA")
    output = BytesIO()
    # `method` changes encoding effort, not decoded pixels. Level 2 keeps the
    # lossless fidelity contract while allowing the 18-texture MPS model to be
    # rebuilt within the normal development verification window.
    image.save(output, "WEBP", lossless=True, quality=100, method=2, exact=True)
    return output.getvalue()


def inline_lossless_webp_textures(path: Path) -> int:
    """Convert embedded images to lossless WebP data URIs.

    Trimesh writes texture images into GLB buffer views.  Converting the
    lossless PNG source here keeps authored label pixels and alpha masks while
    retaining the CSP-safe data-URI transport required by the offline renderer.
    """

    data = path.read_bytes()
    document, old_binary = _parse_glb(data)
    original_views = [dict(view) for view in document.get("bufferViews") or []]
    images = document.get("images") or []
    image_views = {
        int(image["bufferView"])
        for image in images
        if isinstance(image.get("bufferView"), int)
    }

    references = _buffer_view_references(document)
    converted_images: set[int] = set()
    for image_index, image in enumerate(images):
        view_index = image.get("bufferView")
        payload: bytes | None = None
        if view_index in image_views:
            unexpected = [
                item
                for item in references.get(view_index, [])
                if not (len(item) == 3 and item[0] == "images" and item[2] == "bufferView")
            ]
            if unexpected:
                raise ValueError(f"{path.name}: image bufferView {view_index} is shared by {unexpected}")
            view = document["bufferViews"][view_index]
            start = int(view.get("byteOffset", 0))
            payload = old_binary[start : start + int(view["byteLength"])]
        elif isinstance(image.get("uri"), str) and image["uri"].startswith("data:image/"):
            try:
                payload = base64.b64decode(image["uri"].split(",", 1)[1])
            except (IndexError, ValueError) as error:
                raise ValueError(f"{path.name}: invalid image data URI") from error
        if payload is None:
            continue
        lossless = _lossless_webp(payload)
        image["mimeType"] = "image/webp"
        image["uri"] = "data:image/webp;base64," + base64.b64encode(lossless).decode("ascii")
        image.pop("bufferView", None)
        converted_images.add(image_index)

    for texture in document.get("textures") or []:
        source = texture.get("source")
        if source not in converted_images:
            source = (texture.get("extensions") or {}).get("EXT_texture_webp", {}).get("source")
        if source not in converted_images:
            continue
        texture.pop("source", None)
        texture.setdefault("extensions", {})["EXT_texture_webp"] = {"source": int(source)}
    if converted_images:
        used = document.setdefault("extensionsUsed", [])
        if "EXT_texture_webp" not in used:
            used.append("EXT_texture_webp")
        required = document.setdefault("extensionsRequired", [])
        if "EXT_texture_webp" not in required:
            required.append("EXT_texture_webp")

    rebuilt = bytearray()
    for index, view in enumerate(document.get("bufferViews") or []):
        rebuilt.extend(b"\x00" * ((-len(rebuilt)) % 4))
        view["byteOffset"] = len(rebuilt)
        if index in image_views:
            payload = b"\x00" * 4
        else:
            original = original_views[index]
            old_start = int(original.get("byteOffset", 0))
            payload = old_binary[old_start : old_start + int(original["byteLength"])]
        view["byteLength"] = len(payload)
        rebuilt.extend(payload)

    if document.get("buffers"):
        document["buffers"][0]["byteLength"] = len(rebuilt)
    path.write_bytes(_encode_glb(document, bytes(rebuilt)))
    return len(converted_images)


def inline_webp_textures(path: Path) -> int:
    """Backward-compatible alias for the lossless texture normalizer."""

    return inline_lossless_webp_textures(path)


def material_fidelity_summary(path: Path) -> dict[str, int]:
    document, _ = _parse_glb(path.read_bytes())
    materials = document.get("materials") or []
    return {
        "maskMaterials": sum(material.get("alphaMode") == "MASK" for material in materials),
        "blendMaterials": sum(material.get("alphaMode") == "BLEND" for material in materials),
        "normalTextures": sum("normalTexture" in material for material in materials),
        "metallicRoughnessTextures": sum(
            "metallicRoughnessTexture" in (material.get("pbrMetallicRoughness") or {}) for material in materials
        ),
        "occlusionTextures": sum("occlusionTexture" in material for material in materials),
        "emissiveTextures": sum("emissiveTexture" in material for material in materials),
        "losslessTextures": sum(
            b"VP8L" in base64.b64decode(image.get("uri", "").split(",", 1)[1])[:32]
            for image in document.get("images") or []
            if str(image.get("uri", "")).startswith("data:image/webp;base64,")
        ),
    }


def normalize_package(asset_root: Path) -> dict[str, int]:
    manifest_path = asset_root / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    converted_models = converted_images = 0
    for model in manifest.get("models", []):
        path = asset_root / "models" / model["file"]
        count = inline_lossless_webp_textures(path)
        if count:
            converted_models += 1
            converted_images += count
        payload = path.read_bytes()
        document, _ = _parse_glb(payload)
        model["embeddedTextureTransport"] = "data-uri" if document.get("images") else "none"
        model["embeddedTextureFormat"] = "webp-lossless" if document.get("images") else "none"
        model["materialFidelity"] = material_fidelity_summary(path)
        model["bytes"] = len(payload)
        model["sha256"] = hashlib.sha256(payload).hexdigest()

    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"models": converted_models, "images": converted_images}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("asset_root", nargs="?", type=Path, default=Path("assets/imported/sov-kdp"))
    args = parser.parse_args()
    result = normalize_package(args.asset_root.resolve())
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
