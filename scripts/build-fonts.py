#!/usr/bin/env python3
"""Build the self-hosted reading fonts used by the diary.

The I.MingCP subset is a Derived Program under the IPA Font License. Its
internal family and file names are therefore changed to "Daodao Ming". See
assets/fonts/README.md for source provenance and licensing details.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import tempfile
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
CJK_SEED = "，。！？：；、‧·—…“”‘’（）《》〈〉【】〔〕［］｛｝"

SOURCE_HASHES = {
    "iming": "1c411a2e97b65c26aaa01707bbe06919569fcd7683c8bb5db114a96264710458",
    "garamond": "ef9512f92f6d579e5dc75af59a5a4b1b8b47d2eda89e00b954d44520e5369027",
    "noto_serif_cjk": "7da07efb309a89b156090848aab55d9dc57f15b08387b51184b08b89501a382c",
}

FONT_REVISION_TARGETS = {
    "typography.js": (
        "daodao-garamond-roman.woff2",
        "daodao-ming-regular.woff2",
    ),
    "style.css": (
        "daodao-garamond-roman.woff2",
        "daodao-ming-regular.woff2",
        "daodao-noto-serif-sc-light.woff2",
    ),
}

LATIN_RANGES = (
    (0x0020, 0x007E),
    (0x00A0, 0x024F),
    (0x1E00, 0x1EFF),
    (0x20AC, 0x20AC),
)

CJK_RANGES = (
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
    parser.add_argument("--noto-serif-cjk", required=True, type=Path)
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


def collect_cjk_codepoints() -> set[int]:
    text = CJK_SEED + "".join(
        (REPOSITORY_ROOT / relative_path).read_text(encoding="utf-8")
        for relative_path in TEXT_SOURCES
    )

    return {
        ord(character)
        for character in text
        if is_in_ranges(ord(character), CJK_RANGES)
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
    subfamily: str = "Regular",
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
        subfamily=subfamily,
        full_name=full_name,
        postscript_name=postscript_name,
    )

    output.parent.mkdir(parents=True, exist_ok=True)
    font.flavor = "woff2"
    font.save(output, reorderTables=True)
    return unicode_cmap(font)


def relative_to_repository(path: Path) -> str:
    return path.resolve().relative_to(REPOSITORY_ROOT).as_posix()


def prepare_font_revision_updates(
    font_hashes: dict[str, str],
) -> dict[Path, str]:
    updates = {}
    referenced_fonts = set()

    for relative_path, filenames in FONT_REVISION_TARGETS.items():
        path = REPOSITORY_ROOT / relative_path
        contents = path.read_text(encoding="utf-8")

        for filename in filenames:
            if filename not in font_hashes:
                raise ValueError(
                    f"Missing generated hash for {filename} referenced by {relative_path}"
                )

            referenced_fonts.add(filename)
            font_hash = font_hashes[filename]
            pattern = re.compile(rf"{re.escape(filename)}(?:\?v=[0-9a-f]+)?")
            contents, replacement_count = pattern.subn(
                f"{filename}?v={font_hash[:12]}",
                contents,
            )

            if replacement_count == 0:
                raise ValueError(f"Missing {filename} reference in {relative_path}")

        updates[path] = contents

    unreferenced_fonts = set(font_hashes) - referenced_fonts

    if unreferenced_fonts:
        filenames = ", ".join(sorted(unreferenced_fonts))
        raise ValueError(f"No revision targets configured for: {filenames}")

    return updates


def write_text_atomically(path: Path, contents: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    mode = stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o644

    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=path.parent,
        prefix=f".{path.name}.",
        delete=False,
    ) as temporary_file:
        temporary_file.write(contents)
        temporary_file.flush()
        os.fsync(temporary_file.fileno())
        temporary_path = Path(temporary_file.name)

    try:
        temporary_path.chmod(mode)
        temporary_path.replace(path)
    finally:
        temporary_path.unlink(missing_ok=True)


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
    noto_serif_cjk_source_hash = validate_source(
        arguments.noto_serif_cjk,
        "noto_serif_cjk",
        arguments.accept_different_sources,
    )

    cjk_codepoints = collect_cjk_codepoints()
    garamond_source = TTFont(arguments.garamond, recalcTimestamp=False)
    garamond_codepoints = unicode_cmap(garamond_source) & codepoints_in_ranges(
        LATIN_RANGES
    )
    garamond_source.close()

    ming_output = output_directory / "daodao-ming-regular.woff2"
    garamond_output = output_directory / "daodao-garamond-roman.woff2"
    noto_serif_cjk_output = (
        output_directory / "daodao-noto-serif-sc-light.woff2"
    )

    output_directory.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(
        prefix=".daodao-font-build-",
        dir=output_directory.parent,
    ) as staging_directory_name:
        staging_directory = Path(staging_directory_name)
        staged_ming_output = staging_directory / ming_output.name
        staged_garamond_output = staging_directory / garamond_output.name
        staged_noto_serif_cjk_output = (
            staging_directory / noto_serif_cjk_output.name
        )

        built_ming_codepoints = build_subset(
            arguments.iming,
            staged_ming_output,
            cjk_codepoints,
            family="Daodao Ming",
            full_name="Daodao Ming Regular",
            postscript_name="DaodaoMing-Regular",
        )
        build_subset(
            arguments.garamond,
            staged_garamond_output,
            garamond_codepoints,
            family="Daodao Garamond",
            full_name="Daodao Garamond Regular",
            postscript_name="DaodaoGaramond-Regular",
        )
        built_noto_serif_cjk_codepoints = build_subset(
            arguments.noto_serif_cjk,
            staged_noto_serif_cjk_output,
            cjk_codepoints,
            family="Daodao Noto Serif SC",
            subfamily="Light",
            full_name="Daodao Noto Serif SC Light",
            postscript_name="DaodaoNotoSerifSC-Light",
        )

        ming_hash = sha256(staged_ming_output)
        garamond_hash = sha256(staged_garamond_output)
        noto_serif_cjk_hash = sha256(staged_noto_serif_cjk_output)
        font_hashes = {
            ming_output.name: ming_hash,
            garamond_output.name: garamond_hash,
            noto_serif_cjk_output.name: noto_serif_cjk_hash,
        }
        revision_updates = prepare_font_revision_updates(font_hashes)
        manifest = {
            "version": 2,
            "textSources": list(TEXT_SOURCES),
            "cjkCodepoints": [
                f"U+{codepoint:04X}" for codepoint in sorted(cjk_codepoints)
            ],
            "fonts": {
                "ming": {
                    "family": "Daodao Ming",
                    "file": relative_to_repository(ming_output),
                    "sha256": ming_hash,
                    "bytes": staged_ming_output.stat().st_size,
                    "sourceSha256": iming_source_hash,
                    "glyphCodepoints": len(built_ming_codepoints),
                },
                "garamond": {
                    "family": "Daodao Garamond",
                    "file": relative_to_repository(garamond_output),
                    "sha256": garamond_hash,
                    "bytes": staged_garamond_output.stat().st_size,
                    "sourceSha256": garamond_source_hash,
                },
                "notoSerifCjk": {
                    "family": "Daodao Noto Serif SC",
                    "file": relative_to_repository(noto_serif_cjk_output),
                    "sha256": noto_serif_cjk_hash,
                    "bytes": staged_noto_serif_cjk_output.stat().st_size,
                    "sourceSha256": noto_serif_cjk_source_hash,
                    "glyphCodepoints": len(built_noto_serif_cjk_codepoints),
                },
            },
        }
        manifest_path = REPOSITORY_ROOT / "scripts" / "font-subset-manifest.json"
        manifest_contents = json.dumps(
            manifest,
            ensure_ascii=False,
            indent=2,
        ) + "\n"

        output_directory.mkdir(parents=True, exist_ok=True)
        for staged_output, final_output in (
            (staged_ming_output, ming_output),
            (staged_garamond_output, garamond_output),
            (staged_noto_serif_cjk_output, noto_serif_cjk_output),
        ):
            staged_output.replace(final_output)

        write_text_atomically(manifest_path, manifest_contents)

        for path, contents in revision_updates.items():
            write_text_atomically(path, contents)

    print(
        "Built "
        f"{relative_to_repository(ming_output)} ({ming_output.stat().st_size:,} bytes) "
        "and "
        f"{relative_to_repository(garamond_output)} "
        f"({garamond_output.stat().st_size:,} bytes), and "
        f"{relative_to_repository(noto_serif_cjk_output)} "
        f"({noto_serif_cjk_output.stat().st_size:,} bytes)"
    )


if __name__ == "__main__":
    main()
