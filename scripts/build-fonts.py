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
import shutil
import stat
import tempfile
import unicodedata
from pathlib import Path
from typing import Iterable

from fontTools import subset
from fontTools.ttLib import TTFont


REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
TEXT_SOURCES = (
    "daodao.master.txt",
    "every-lap-counts.master.txt",
    "redactions.json",
    "index.html",
    "app.js",
    "typography.js",
)
COMMON_HANZI_SOURCE = "scripts/tongyong-guifan-hanzi-level-1.txt"
COMMON_HANZI_COUNT = 3500
CJK_SEED = "，。！？：；、‧·—…“”‘’（）《》〈〉【】〔〕［］｛｝"
GARAMOND_EXTRA_CODEPOINTS = frozenset((0x03C0, 0x2192, 0x2212))
SERIF_SUPPLEMENT_CODEPOINTS = frozenset(
    (0x01D0, 0x03C0, 0x2192, 0x21CC, 0x2514)
)
READING_SCHEMES = {
    "iming-garamond": ("garamond", "ming", "serifSupplement"),
    "noto-system": ("notoSerif300", "serifSupplement", "notoSerifCjk"),
}

SOURCE_HASHES = {
    "iming": "1c411a2e97b65c26aaa01707bbe06919569fcd7683c8bb5db114a96264710458",
    "garamond": "ef9512f92f6d579e5dc75af59a5a4b1b8b47d2eda89e00b954d44520e5369027",
    "noto_serif_cjk": "7da07efb309a89b156090848aab55d9dc57f15b08387b51184b08b89501a382c",
}

FONT_REVISION_TARGETS = {
    "typography.js": (
        "daodao-garamond-roman.woff2",
        "daodao-ming-regular.woff2",
        "noto-serif-300.ttf",
    ),
    "style.css": (
        "daodao-garamond-roman.woff2",
        "daodao-ming-regular.woff2",
        "daodao-serif-supplement.woff2",
        "daodao-noto-serif-sc-light.woff2",
        "noto-serif-300.ttf",
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


def collect_required_cjk_codepoints(
    required_reading_codepoints: set[int],
) -> set[int]:
    return {
        codepoint
        for codepoint in required_reading_codepoints
        if is_in_ranges(codepoint, CJK_RANGES)
    }


def collect_common_hanzi_codepoints() -> set[int]:
    source_path = REPOSITORY_ROOT / COMMON_HANZI_SOURCE
    entries: list[int] = []
    pattern = re.compile(r"^(\d{4}) ([\u4E00-\u9FFF])$")

    for line_number, raw_line in enumerate(
        source_path.read_text(encoding="utf-8").splitlines(),
        start=1,
    ):
        line = raw_line.strip()

        if not line or line.startswith("#"):
            continue

        match = pattern.fullmatch(line)

        if not match:
            raise ValueError(
                f"Invalid common Hanzi entry at {COMMON_HANZI_SOURCE}:"
                f"{line_number}: {raw_line!r}"
            )

        expected_sequence = len(entries) + 1
        sequence = int(match.group(1))

        if sequence != expected_sequence:
            raise ValueError(
                f"Unexpected common Hanzi sequence {sequence:04d}; "
                f"expected {expected_sequence:04d}"
            )

        entries.append(ord(match.group(2)))

    if len(entries) != COMMON_HANZI_COUNT:
        raise ValueError(
            f"Expected {COMMON_HANZI_COUNT} common Hanzi entries; "
            f"found {len(entries)}"
        )

    if len(set(entries)) != len(entries):
        raise ValueError("Common Hanzi entries must be unique")

    return set(entries)


def collect_existing_cjk_codepoints() -> set[int]:
    manifest_path = REPOSITORY_ROOT / "scripts" / "font-subset-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    labels = manifest.get("cjkCodepoints")

    if not isinstance(labels, list):
        raise ValueError("Existing font manifest has no cjkCodepoints array")

    codepoints: list[int] = []

    for label in labels:
        if not isinstance(label, str) or not re.fullmatch(
            r"U\+[0-9A-F]{4,6}", label
        ):
            raise ValueError(f"Invalid existing CJK codepoint label: {label!r}")

        codepoints.append(int(label[2:], 16))

    if codepoints != sorted(set(codepoints)):
        raise ValueError("Existing cjkCodepoints must be unique and sorted")

    outside_cjk_ranges = {
        codepoint
        for codepoint in codepoints
        if not is_in_ranges(codepoint, CJK_RANGES)
    }

    if outside_cjk_ranges:
        labels = ", ".join(codepoint_labels(outside_cjk_ranges)[:12])
        raise ValueError(f"Existing cjkCodepoints contain non-CJK values: {labels}")

    return set(codepoints)


def collect_required_reading_codepoints() -> set[int]:
    text = CJK_SEED + "".join(
        (REPOSITORY_ROOT / relative_path).read_text(encoding="utf-8")
        for relative_path in TEXT_SOURCES
    )

    return {
        ord(character)
        for character in text
        if not unicodedata.category(character).startswith("C")
    }


def codepoint_labels(codepoints: Iterable[int]) -> list[str]:
    return [f"U+{codepoint:04X}" for codepoint in sorted(codepoints)]


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


def replace_binary_atomically(source: Path, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    mode = stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o644

    with source.open("rb") as source_file, tempfile.NamedTemporaryFile(
        mode="wb",
        dir=path.parent,
        prefix=f".{path.name}.",
        delete=False,
    ) as temporary_file:
        shutil.copyfileobj(source_file, temporary_file)
        temporary_file.flush()
        os.fsync(temporary_file.fileno())
        temporary_path = Path(temporary_file.name)

    try:
        temporary_path.chmod(mode)
        temporary_path.replace(path)
    finally:
        temporary_path.unlink(missing_ok=True)


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

    required_reading_codepoints = collect_required_reading_codepoints()
    required_cjk_codepoints = collect_required_cjk_codepoints(
        required_reading_codepoints
    )
    common_hanzi_codepoints = collect_common_hanzi_codepoints()
    existing_cjk_codepoints = collect_existing_cjk_codepoints()
    cjk_codepoints = (
        required_cjk_codepoints
        | common_hanzi_codepoints
        | existing_cjk_codepoints
    )
    garamond_source = TTFont(arguments.garamond, recalcTimestamp=False)
    garamond_source_codepoints = unicode_cmap(garamond_source)
    garamond_codepoints = (
        garamond_source_codepoints & codepoints_in_ranges(LATIN_RANGES)
    ) | GARAMOND_EXTRA_CODEPOINTS
    missing_garamond_extras = (
        GARAMOND_EXTRA_CODEPOINTS - garamond_source_codepoints
    )
    garamond_source.close()

    if missing_garamond_extras:
        labels = ", ".join(codepoint_labels(missing_garamond_extras))
        raise ValueError(f"EB Garamond is missing configured extras: {labels}")

    ming_output = output_directory / "daodao-ming-regular.woff2"
    garamond_output = output_directory / "daodao-garamond-roman.woff2"
    serif_supplement_output = (
        output_directory / "daodao-serif-supplement.woff2"
    )
    noto_serif_cjk_output = (
        output_directory / "daodao-noto-serif-sc-light.woff2"
    )
    noto_serif_300_output = output_directory / "noto-serif-300.ttf"

    if not noto_serif_300_output.is_file():
        raise FileNotFoundError(
            f"Missing tracked legacy reading font: {noto_serif_300_output}"
        )

    noto_serif_300_font = TTFont(noto_serif_300_output, recalcTimestamp=False)
    noto_serif_300_codepoints = unicode_cmap(noto_serif_300_font)
    noto_serif_300_font.close()
    noto_serif_300_hash = sha256(noto_serif_300_output)

    output_directory.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(
        prefix=".daodao-font-build-",
        dir=output_directory.parent,
    ) as staging_directory_name:
        staging_directory = Path(staging_directory_name)
        staged_ming_output = staging_directory / ming_output.name
        staged_garamond_output = staging_directory / garamond_output.name
        staged_serif_supplement_output = (
            staging_directory / serif_supplement_output.name
        )
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
        built_garamond_codepoints = build_subset(
            arguments.garamond,
            staged_garamond_output,
            garamond_codepoints,
            family="Daodao Garamond",
            full_name="Daodao Garamond Regular",
            postscript_name="DaodaoGaramond-Regular",
        )
        built_serif_supplement_codepoints = build_subset(
            arguments.noto_serif_cjk,
            staged_serif_supplement_output,
            set(SERIF_SUPPLEMENT_CODEPOINTS),
            family="Daodao Serif Supplement",
            subfamily="Light",
            full_name="Daodao Serif Supplement Light",
            postscript_name="DaodaoSerifSupplement-Light",
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

        exact_subsets = {
            "Daodao Ming": (built_ming_codepoints, cjk_codepoints),
            "Daodao Garamond": (
                built_garamond_codepoints,
                garamond_codepoints,
            ),
            "Daodao Serif Supplement": (
                built_serif_supplement_codepoints,
                set(SERIF_SUPPLEMENT_CODEPOINTS),
            ),
            "Daodao Noto Serif SC": (
                built_noto_serif_cjk_codepoints,
                cjk_codepoints,
            ),
        }

        for family, (actual_codepoints, expected_codepoints) in (
            exact_subsets.items()
        ):
            if actual_codepoints != expected_codepoints:
                differences = actual_codepoints ^ expected_codepoints
                labels = ", ".join(codepoint_labels(differences)[:12])
                raise ValueError(
                    f"{family} subset cmap is not exact: {labels}"
                )

        font_codepoints = {
            "ming": built_ming_codepoints,
            "garamond": built_garamond_codepoints,
            "serifSupplement": built_serif_supplement_codepoints,
            "notoSerif300": noto_serif_300_codepoints,
            "notoSerifCjk": built_noto_serif_cjk_codepoints,
        }

        for scheme, font_keys in READING_SCHEMES.items():
            covered_codepoints = set().union(
                *(font_codepoints[font_key] for font_key in font_keys)
            )
            missing_codepoints = required_reading_codepoints - covered_codepoints

            if missing_codepoints:
                labels = ", ".join(codepoint_labels(missing_codepoints)[:12])
                raise ValueError(
                    f"Reading scheme {scheme} has no reviewed coverage for: "
                    f"{labels}"
                )

        ming_hash = sha256(staged_ming_output)
        garamond_hash = sha256(staged_garamond_output)
        serif_supplement_hash = sha256(staged_serif_supplement_output)
        noto_serif_cjk_hash = sha256(staged_noto_serif_cjk_output)
        font_hashes = {
            ming_output.name: ming_hash,
            garamond_output.name: garamond_hash,
            serif_supplement_output.name: serif_supplement_hash,
            noto_serif_cjk_output.name: noto_serif_cjk_hash,
            noto_serif_300_output.name: noto_serif_300_hash,
        }
        revision_updates = prepare_font_revision_updates(font_hashes)
        common_hanzi_path = REPOSITORY_ROOT / COMMON_HANZI_SOURCE
        manifest = {
            "version": 4,
            "textSources": list(TEXT_SOURCES),
            "commonHanzi": {
                "file": COMMON_HANZI_SOURCE,
                "entries": len(common_hanzi_codepoints),
                "sha256": sha256(common_hanzi_path),
            },
            "cjkCodepoints": codepoint_labels(cjk_codepoints),
            "readingSchemes": {
                scheme: list(font_keys)
                for scheme, font_keys in READING_SCHEMES.items()
            },
            "fonts": {
                "ming": {
                    "family": "Daodao Ming",
                    "file": relative_to_repository(ming_output),
                    "sha256": ming_hash,
                    "bytes": staged_ming_output.stat().st_size,
                    "sourceSha256": iming_source_hash,
                    "glyphCodepoints": len(built_ming_codepoints),
                    "codepointSet": "cjk",
                    "preload": True,
                },
                "garamond": {
                    "family": "Daodao Garamond",
                    "file": relative_to_repository(garamond_output),
                    "sha256": garamond_hash,
                    "bytes": staged_garamond_output.stat().st_size,
                    "sourceSha256": garamond_source_hash,
                    "glyphCodepoints": len(built_garamond_codepoints),
                    "codepoints": codepoint_labels(
                        built_garamond_codepoints
                    ),
                    "preload": True,
                },
                "serifSupplement": {
                    "family": "Daodao Serif Supplement",
                    "file": relative_to_repository(serif_supplement_output),
                    "sha256": serif_supplement_hash,
                    "bytes": staged_serif_supplement_output.stat().st_size,
                    "sourceSha256": noto_serif_cjk_source_hash,
                    "glyphCodepoints": len(built_serif_supplement_codepoints),
                    "codepoints": codepoint_labels(
                        built_serif_supplement_codepoints
                    ),
                    "preload": False,
                },
                "notoSerif300": {
                    "family": "Daodao Noto Serif",
                    "file": relative_to_repository(noto_serif_300_output),
                    "sha256": noto_serif_300_hash,
                    "bytes": noto_serif_300_output.stat().st_size,
                    "glyphCodepoints": len(noto_serif_300_codepoints),
                    "codepoints": codepoint_labels(noto_serif_300_codepoints),
                    "preload": True,
                    "trackedSourceAsset": True,
                },
                "notoSerifCjk": {
                    "family": "Daodao Noto Serif SC",
                    "file": relative_to_repository(noto_serif_cjk_output),
                    "sha256": noto_serif_cjk_hash,
                    "bytes": staged_noto_serif_cjk_output.stat().st_size,
                    "sourceSha256": noto_serif_cjk_source_hash,
                    "glyphCodepoints": len(built_noto_serif_cjk_codepoints),
                    "codepointSet": "cjk",
                    "preload": False,
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
            (staged_serif_supplement_output, serif_supplement_output),
            (staged_noto_serif_cjk_output, noto_serif_cjk_output),
        ):
            replace_binary_atomically(staged_output, final_output)

        write_text_atomically(manifest_path, manifest_contents)

        for path, contents in revision_updates.items():
            write_text_atomically(path, contents)

    print(
        "Built "
        f"{relative_to_repository(ming_output)} ({ming_output.stat().st_size:,} bytes) "
        "and "
        f"{relative_to_repository(garamond_output)} "
        f"({garamond_output.stat().st_size:,} bytes), "
        f"{relative_to_repository(serif_supplement_output)} "
        f"({serif_supplement_output.stat().st_size:,} bytes), and "
        f"{relative_to_repository(noto_serif_cjk_output)} "
        f"({noto_serif_cjk_output.stat().st_size:,} bytes)"
    )


if __name__ == "__main__":
    main()
