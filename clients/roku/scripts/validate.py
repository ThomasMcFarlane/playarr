#!/usr/bin/env python3
"""Dependency-free structural checks for the Playarr Roku channel."""

from __future__ import annotations

import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REQUIRED_MANIFEST_KEYS = {
    "title",
    "major_version",
    "minor_version",
    "build_version",
    "ui_resolutions",
    "mm_icon_focus_hd",
    "mm_icon_side_hd",
}
FORBIDDEN_SUFFIXES = {".db", ".env", ".key", ".pem", ".p12", ".zip"}
PLACEHOLDER_PATTERNS = (
    re.compile(r"BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY"),
    re.compile(r"(?i)(?:access|refresh)[_-]?token\s*[:=]\s*['\"]?[A-Za-z0-9_-]{24,}"),
)


def fail(message: str) -> None:
    raise ValueError(message)


def validate_manifest() -> None:
    values: dict[str, str] = {}
    for raw_line in (ROOT / "manifest").read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            fail(f"manifest line has no '=': {raw_line}")
        key, value = line.split("=", 1)
        values[key] = value
    missing = REQUIRED_MANIFEST_KEYS - values.keys()
    if missing:
        fail(f"manifest is missing: {', '.join(sorted(missing))}")
    if values["ui_resolutions"] != "fhd":
        fail("the Roku scene is designed for the fhd coordinate space")
    for key in ("mm_icon_focus_hd", "mm_icon_side_hd", "mm_icon_focus_fhd", "mm_icon_side_fhd"):
        value = values.get(key)
        if value is None:
            continue
        if not value.startswith("pkg:/"):
            fail(f"manifest {key} must reference a packaged pkg:/ asset")
        if not (ROOT / value.removeprefix("pkg:/")).is_file():
            fail(f"manifest {key} points at a missing file: {value}")


def validate_xml() -> None:
    xml_files = sorted((ROOT / "components").glob("*.xml"))
    if not xml_files:
        fail("no SceneGraph components found")
    component_names: set[str] = set()
    for path in xml_files:
        root = ET.parse(path).getroot()
        if root.tag != "component":
            fail(f"{path.name}: root element must be component")
        name = root.attrib.get("name")
        if not name:
            fail(f"{path.name}: component name is required")
        if name in component_names:
            fail(f"duplicate component name: {name}")
        component_names.add(name)
        for script in root.findall("script"):
            uri = script.attrib.get("uri", "")
            if uri.startswith("pkg:/") and not (ROOT / uri.removeprefix("pkg:/")).is_file():
                fail(f"{path.name}: missing script {uri}")


def validate_brightscript() -> None:
    scripts = sorted((ROOT / "source").glob("*.brs")) + sorted(
        (ROOT / "components").glob("*.brs")
    )
    if not (ROOT / "source" / "main.brs").is_file():
        fail("source/main.brs is required")
    for path in scripts:
        text = path.read_text(encoding="utf-8")
        starts = len(re.findall(r"(?im)^\s*(?:sub|function)\s+", text))
        ends = len(re.findall(r"(?im)^\s*end\s+(?:sub|function)\s*$", text))
        if starts != ends:
            fail(f"{path.name}: {starts} routines start but {ends} end")
        if "?." in text or "?[" in text or "?(" in text:
            fail(f"{path.name}: optional chaining would raise the Roku OS floor")


def validate_package_contents() -> None:
    for path in ROOT.rglob("*"):
        if not path.is_file() or "build" in path.parts:
            continue
        if path.suffix.lower() in FORBIDDEN_SUFFIXES:
            fail(f"unsafe package file type: {path.relative_to(ROOT)}")
        if path.suffix.lower() not in {".brs", ".xml", ".md", ".sh", ".py", ""}:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            fail(f"unexpected binary file: {path.relative_to(ROOT)}")
        for pattern in PLACEHOLDER_PATTERNS:
            if pattern.search(text):
                fail(f"possible secret in {path.relative_to(ROOT)}")


def validate_source_contract() -> None:
    source = "\n".join(
        path.read_text(encoding="utf-8")
        for path in sorted((ROOT / "source").glob("*.brs"))
        + sorted((ROOT / "components").glob("*.brs"))
    )
    required_fragments = (
        "/api/system/version",
        "/api/v1/auth/refresh",
        "/api/v1/oauth/device/code",
        "/api/v1/oauth/token",
        "/api/v1/users/profiles",
        "/api/v1/catalog?",
        "/api/v1/catalog/",
        "/api/v1/playback/",
        "/api/v1/playback/progress",
        "/events",
    )
    for fragment in required_fragments:
        if fragment not in source:
            fail(f"missing required API path: {fragment}")
    if 'm.library = m.top.findNode("libraryList")' not in source:
        fail("library must use the native RowList scroll container")
    if 'm.video = m.top.findNode("video")' not in source:
        fail("playback must use the native Video node")


def main() -> int:
    checks = (
        validate_manifest,
        validate_xml,
        validate_brightscript,
        validate_package_contents,
        validate_source_contract,
    )
    for check in checks:
        check()
    print(f"Validated {len(checks)} Roku channel checks")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ValueError as error:
        print(f"validation failed: {error}", file=sys.stderr)
        raise SystemExit(1)
