#!/usr/bin/env python3
"""Generate docs/ERROR_CODES.md from Soroban contract error enums.

The generator scans the workspace for `#[contracterror]` enums, extracts the
variant names and codes from source, and uses either `///` docs or the `Display`
message as the human-readable description.

Run without arguments to rewrite `docs/ERROR_CODES.md`.
Run with `--check` to verify that the file is up to date.
"""

from __future__ import annotations

import argparse
import difflib
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


WORKSPACE_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_FILE = WORKSPACE_ROOT / "docs" / "ERROR_CODES.md"


@dataclass(frozen=True)
class Variant:
    name: str
    code: int
    description: str


@dataclass(frozen=True)
class ErrorEnum:
    section: str
    enum_name: str
    variants: list[Variant]


VARIANT_RE = re.compile(r"^\s*([A-Za-z0-9_]+)\s*=\s*([0-9_]+),\s*(?://.*)?$")
DOC_RE = re.compile(r"^\s*///\s?(.*)$")
DISPLAY_IMPL_START_RE = re.compile(
    r"impl\s+(?:core::fmt::)?Display\s+for\s+([A-Za-z0-9_]+)\s*\{",
    re.MULTILINE,
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="verify docs are up to date")
    args = parser.parse_args()

    enums = collect_enums()
    generated = render_markdown(enums)

    if args.check:
        current = OUTPUT_FILE.read_text(encoding="utf-8")
        if current != generated:
            diff = difflib.unified_diff(
                current.splitlines(True),
                generated.splitlines(True),
                fromfile=str(OUTPUT_FILE),
                tofile="generated",
            )
            raise SystemExit("docs/ERROR_CODES.md is out of date:\n" + "".join(diff))
        return 0

    OUTPUT_FILE.write_text(generated, encoding="utf-8")
    return 0


def collect_enums() -> list[ErrorEnum]:
    source_files = [
        WORKSPACE_ROOT / "shared" / "src" / "lib.rs",
        WORKSPACE_ROOT / "shared" / "src" / "reentrancy_guard.rs",
        WORKSPACE_ROOT / "acbu_multisig" / "src" / "lib.rs",
        WORKSPACE_ROOT / "acbu_savings_vault" / "src" / "lib.rs",
        WORKSPACE_ROOT / "acbu_lending_pool" / "src" / "lib.rs",
        WORKSPACE_ROOT / "acbu_escrow" / "src" / "lib.rs",
        WORKSPACE_ROOT / "acbu_minting" / "src" / "lib.rs",
        WORKSPACE_ROOT / "acbu_oracle" / "src" / "lib.rs",
        WORKSPACE_ROOT / "acbu_reserve_tracker" / "src" / "lib.rs",
    ]

    enums: list[ErrorEnum] = []
    for path in source_files:
        text = path.read_text(encoding="utf-8")
        display_docs = parse_display_docs(text)
        for enum_name, body in find_error_enums(text):
            variants = parse_variants(body, display_docs.get(enum_name, {}))
            section = section_name(path, enum_name)
            enums.append(ErrorEnum(section=section, enum_name=enum_name, variants=variants))

    return enums


def find_error_enums(text: str) -> Iterable[tuple[str, str]]:
    for match in re.finditer(r"#\[(?:soroban_sdk::)?contracterror\]\s*.*?pub\s+enum\s+([A-Za-z0-9_]+)\s*\{", text, re.DOTALL):
        enum_name = match.group(1)
        body_start = text.find("{", match.end() - 1)
        if body_start == -1:
            continue
        body, _ = extract_braced_block(text, body_start)
        yield enum_name, body


def extract_braced_block(text: str, open_brace_index: int) -> tuple[str, int]:
    depth = 0
    for index in range(open_brace_index, len(text)):
        char = text[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[open_brace_index + 1 : index], index + 1
    raise ValueError("unbalanced braces while parsing enum")


def parse_variants(body: str, display_docs: dict[str, str]) -> list[Variant]:
    variants: list[Variant] = []
    pending_docs: list[str] = []

    for raw_line in body.splitlines():
        doc_match = DOC_RE.match(raw_line)
        if doc_match:
            pending_docs.append(doc_match.group(1).strip())
            continue

        variant_match = VARIANT_RE.match(raw_line)
        if variant_match:
            name = variant_match.group(1)
            code = int(variant_match.group(2).replace("_", ""))
            description = " ".join(filter(None, pending_docs)) or display_docs.get(name, "") or humanize_variant(name)
            variants.append(Variant(name=name, code=code, description=description))
            pending_docs = []
            continue

        if raw_line.strip():
            pending_docs = []

    return variants


def parse_display_docs(text: str) -> dict[str, dict[str, str]]:
    result: dict[str, dict[str, str]] = {}
    for impl_match in DISPLAY_IMPL_START_RE.finditer(text):
        enum_name = impl_match.group(1)
        body_start = text.find("{", impl_match.end() - 1)
        if body_start == -1:
            continue
        body, _ = extract_braced_block(text, body_start)
        docs: dict[str, str] = {}
        for line in body.splitlines():
            arm = re.search(
                r"(?:Self|[A-Za-z0-9_]+)::([A-Za-z0-9_]+)\s*=>.*?\"([^\"]+)\"",
                line,
            )
            if arm:
                docs[arm.group(1)] = arm.group(2).strip()
        result[enum_name] = docs
    return result


def section_name(path: Path, _enum_name: str) -> str:
    crate = path.parent.parent.name
    if path.name == "reentrancy_guard.rs":
        return "shared / reentrancy guard"
    if crate == "shared":
        return "shared"
    return crate


def render_markdown(enums: list[ErrorEnum]) -> str:
    sections: list[str] = []

    sections.append("# Soroban contract error codes (C-054)")
    sections.append("")
    sections.append(
        "This file is generated from the `#[contracterror]` enums in the workspace. "
        "Run `python scripts/generate_error_codes.py` to refresh it, or "
        "`python scripts/generate_error_codes.py --check` to verify it stays in sync."
    )
    sections.append("")
    sections.append(
        "Clients map `invoke_contract` / simulation failures using the contract error `u32` code. "
        "Codes are stable per contract, so do not renumber them without a migration plan."
    )
    sections.append("")

    for enum in enums:
        sections.append(f"## `{enum.section}` - `{enum.enum_name}`")
        sections.append("")
        sections.append("| Code | Variant | Description |")
        sections.append("| ---: | --- | --- |")
        for variant in enum.variants:
            description = escape_md(variant.description) if variant.description else "-"
            sections.append(f"| {variant.code} | `{variant.name}` | {description} |")
        sections.append("")

    return "\n".join(sections).rstrip() + "\n"


def escape_md(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ").strip()


def humanize_variant(name: str) -> str:
    words: list[str] = []
    current = []
    for index, char in enumerate(name):
        if index and char.isupper() and (not name[index - 1].isupper() or (index + 1 < len(name) and name[index + 1].islower())):
            words.append("".join(current))
            current = [char.lower()]
        else:
            current.append(char.lower())
    if current:
        words.append("".join(current))
    return " ".join(words)


if __name__ == "__main__":
    raise SystemExit(main())
