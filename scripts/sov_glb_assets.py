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
from pathlib import Path
from typing import Any


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


def inline_webp_textures(path: Path) -> int:
    """Inline bufferView-backed WebP images and return the converted count."""

    data = path.read_bytes()
    document, old_binary = _parse_glb(data)
    original_views = [dict(view) for view in document.get("bufferViews") or []]
    images = document.get("images") or []
    image_views = {
        int(image["bufferView"])
        for image in images
        if image.get("mimeType") == "image/webp" and isinstance(image.get("bufferView"), int)
    }
    if not image_views:
        return 0

    references = _buffer_view_references(document)
    for image in images:
        view_index = image.get("bufferView")
        if view_index not in image_views:
            continue
        unexpected = [
            item
            for item in references.get(view_index, [])
            if not (len(item) == 3 and item[0] == "images" and item[2] == "bufferView")
        ]
        if unexpected:
            raise ValueError(f"{path.name}: image bufferView {view_index} is shared by {unexpected}")

        view = document["bufferViews"][view_index]
        start = int(view.get("byteOffset", 0))
        end = start + int(view["byteLength"])
        payload = old_binary[start:end]
        if not (payload.startswith(b"RIFF") and payload[8:12] == b"WEBP"):
            raise ValueError(f"{path.name}: image bufferView {view_index} is not WebP")
        image["uri"] = "data:image/webp;base64," + base64.b64encode(payload).decode("ascii")
        image.pop("bufferView", None)

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
    return len(image_views)


def normalize_package(asset_root: Path) -> dict[str, int]:
    manifest_path = asset_root / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    converted_models = converted_images = 0
    for model in manifest.get("models", []):
        path = asset_root / "models" / model["file"]
        count = inline_webp_textures(path)
        if count:
            converted_models += 1
            converted_images += count
        payload = path.read_bytes()
        document, _ = _parse_glb(payload)
        model["embeddedTextureTransport"] = "data-uri" if document.get("images") else "none"
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
