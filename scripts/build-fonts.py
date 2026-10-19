#!/usr/bin/env python3
"""Build the self-hosted reading fonts used by the diary.

The I.MingCP subset is a Derived Program under the IPA Font License. Its
internal family and file names are therefore changed to "Daodao Ming". See
assets/fonts/README.md for source provenance and replacement instructions.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Iterable

from fontTools import subset
from fontTools.ttLib import TTFont


REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
TEXT_SOURCES = (
    "daodao.master.txt",
    "redactions.json",
    "index.html",
    "app.js",
    "typography.js",
)
MING_SEED = "，。！？：；、‧·—…“”‘’（）《》〈〉【】〔〕［］｛｝"

SOURCE_HASHES = {
    "iming": "1c411a2e97b65c26aaa01707bbe06919569fcd7683c8bb5db114a96264710458",
    "garamond": "ef9512f92f6d579e5dc75af59a5a4b1b8b47d2eda89e00b954d44520e5369027",
}

LATIN_RANGES = (
    (0x0020, 0x007E),
    (0x00A0, 0x024F),
    (0x1E00, 0x1EFF),
    (0x20AC, 0x20AC),
)

MING_RANGES = (
    (0x2000, 0x206F),  # General punctuation, kept out of EB Garamond.
    (0x2E80, 0x33FF),  # CJK radicals, punctuation, kana and compatibility.
    (0x3400, 0x4DBF),  # CJK Unified Ideographs Extension A.
    (0x4E00, 0x9FFF),  # CJK Unified Ideographs.
    (0xF900, 0xFAFF),  # CJK Compatibility Ideographs.
    (0xFE10, 0xFE1F),  # Vertical forms.
    (0xFE30, 0xFE4F),  # CJK compatibility forms.
    (0xFF00, 0xFFEF),  # Halfwidth and fullwidth forms.
    (0x20000, 0x2FA1F),  # CJK extensions and compatibility supplement.
    (0x2EBF0, 0x2EE5F),  # CJK Unified Ideographs Extension I.
    (0x30000, 0x323AF),  # CJK Unified Ideographs Extensions G and H.
)


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--iming", required=True, type=Path)
    parser.add_argument("--garamond", required=True, type=Path)
    parser.add_argument(
        "--output",
        type=Path,
        default=REPOSITORY_ROOT / "assets" / "fonts",
    )
    parser.add_argument(
        "--accept-different-sources",
        action="store_true",
        help="Allow sources whose hashes differ from the pinned upstream files.",
    )
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()

    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)

    return digest.hexdigest()


def validate_source(path: Path, source_name: str, allow_different: bool) -> str:
    if not path.is_file():
        raise FileNotFoundError(f"Missing {source_name} source font: {path}")

    actual_hash = sha256(path)
    expected_hash = SOURCE_HASHES[source_name]

    if not allow_different and actual_hash != expected_hash:
        raise ValueError(
            f"Unexpected {source_name} source hash: {actual_hash}; "
            f"expected {expected_hash}"
        )

    return actual_hash


def codepoints_in_ranges(ranges: Iterable[tuple[int, int]]) -> set[int]:
    return {
        codepoint
        for start, end in ranges
        for codepoint in range(start, end + 1)
    }


def is_in_ranges(codepoint: int, ranges: Iterable[tuple[int, int]]) -> bool:
    return any(start <= codepoint <= end for start, end in ranges)


def collect_ming_codepoints() -> set[int]:
    text = MING_SEED + "".join(
        (REPOSITORY_ROOT / relative_path).read_text(encoding="utf-8")
        for relative_path in TEXT_SOURCES
    )

    return {
        ord(character)
        for character in text
        if is_in_ranges(ord(character), MING_RANGES)
    }


def unicode_cmap(font: TTFont) -> set[int]:
    return set().union(
        *(
            set(table.cmap)
            for table in font["cmap"].tables
            if table.isUnicode()
        )
    )


def replace_names(
    font: TTFont,
    *,
    family: str,
    subfamily: str,
    full_name: str,
    postscript_name: str,
) -> None:
    name_table = font["name"]
    values = {
        1: family,
        2: subfamily,
        3: f"{postscript_name}:derived",
        4: full_name,
        6: postscript_name,
        16: family,
        17: subfamily,
        25: postscript_name.replace("-", ""),
    }

    for name_id, value in values.items():
        name_table.removeNames(nameID=name_id)
        name_table.setName(value, name_id, 3, 1, 0x0409)
        name_table.setName(value, name_id, 1, 0, 0)


def build_subset(
    source: Path,
    output: Path,
    codepoints: set[int],
    *,
    family: str,
    full_name: str,
    postscript_name: str,
) -> set[int]:
    font = TTFont(source, recalcTimestamp=False)
    available = unicode_cmap(font)
    missing = codepoints - available

    if missing:
        missing_labels = ", ".join(f"U+{value:04X}" for value in sorted(missing))
        raise ValueError(f"{source.name} is missing required glyphs: {missing_labels}")

    options = subset.Options()
    options.drop_tables.append("meta")
    options.hinting = True
    options.layout_features = [
        "ccmp",
        "locl",
        "kern",
        "liga",
        "clig",
        "calt",
        "mark",
        "mkmk",
    ]
    options.layout_scripts = ["*"]
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.name_legacy = True
    options.recalc_average_width = True

    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=codepoints)
    subsetter.subset(font)
    replace_names(
        font,
        family=family,
        subfamily="Regular",
        full_name=full_name,
        postscript_name=postscript_name,
    )

    output.parent.mkdir(parents=True, exist_ok=True)
    font.flavor = "woff2"
    font.save(output, reorderTables=True)
    return unicode_cmap(font)


def relative_to_repository(path: Path) -> str:
    return path.resolve().relative_to(REPOSITORY_ROOT).as_posix()


def update_font_revisions(font_hashes: dict[str, str]) -> None:
    for relative_path in ("typography.js", "style.css"):
        path = REPOSITORY_ROOT / relative_path
        contents = path.read_text(encoding="utf-8")

        for filename, font_hash in font_hashes.items():
            pattern = re.compile(rf"{re.escape(filename)}(?:\?v=[0-9a-f]+)?")
            contents, replacement_count = pattern.subn(
                f"{filename}?v={font_hash[:12]}",
                contents,
            )

            if replacement_count == 0:
                raise ValueError(f"Missing {filename} reference in {relative_path}")

        path.write_text(contents, encoding="utf-8")


def main() -> None:
    arguments = parse_arguments()
    output_directory = arguments.output.resolve()
    iming_source_hash = validate_source(
        arguments.iming,
        "iming",
        arguments.accept_different_sources,
    )
    garamond_source_hash = validate_source(
        arguments.garamond,
        "garamond",
        arguments.accept_different_sources,
    )

    ming_codepoints = collect_ming_codepoints()
    garamond_source = TTFont(arguments.garamond, recalcTimestamp=False)
    garamond_codepoints = unicode_cmap(garamond_source) & codepoints_in_ranges(
        LATIN_RANGES
    )
    garamond_source.close()

    ming_output = output_directory / "daodao-ming-regular.woff2"
    garamond_output = output_directory / "daodao-garamond-roman.woff2"

    built_ming_codepoints = build_subset(
        arguments.iming,
        ming_output,
        ming_codepoints,
        family="Daodao Ming",
        full_name="Daodao Ming Regular",
        postscript_name="DaodaoMing-Regular",
    )
    build_subset(
        arguments.garamond,
        garamond_output,
        garamond_codepoints,
        family="Daodao Garamond",
        full_name="Daodao Garamond Regular",
        postscript_name="DaodaoGaramond-Regular",
    )

    ming_hash = sha256(ming_output)
    garamond_hash = sha256(garamond_output)
    manifest = {
        "version": 1,
        "textSources": list(TEXT_SOURCES),
        "mingCodepoints": [
            f"U+{codepoint:04X}" for codepoint in sorted(ming_codepoints)
        ],
        "fonts": {
            "ming": {
                "family": "Daodao Ming",
                "file": relative_to_repository(ming_output),
                "sha256": ming_hash,
                "bytes": ming_output.stat().st_size,
                "sourceSha256": iming_source_hash,
                "glyphCodepoints": len(built_ming_codepoints),
            },
            "garamond": {
                "family": "Daodao Garamond",
                "file": relative_to_repository(garamond_output),
                "sha256": garamond_hash,
                "bytes": garamond_output.stat().st_size,
                "sourceSha256": garamond_source_hash,
            },
        },
    }
    manifest_path = REPOSITORY_ROOT / "scripts" / "font-subset-manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    update_font_revisions(
        {
            ming_output.name: ming_hash,
            garamond_output.name: garamond_hash,
        }
    )

    print(
        "Built "
        f"{relative_to_repository(ming_output)} ({ming_output.stat().st_size:,} bytes) "
        "and "
        f"{relative_to_repository(garamond_output)} "
        f"({garamond_output.stat().st_size:,} bytes)"
    )


if __name__ == "__main__":
    main()
