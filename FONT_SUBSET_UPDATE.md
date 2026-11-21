# Updating the Font Subsets

The site uses planned-coverage reading-font subsets. The Chinese subsets keep
all previously reviewed CJK codepoints and also include all 6,500 first- and
second-level characters from the Table of General Standard Chinese Characters.
When a diary entry, swimming record, or interface file introduces a character that
is not covered by the reviewed self-hosted fonts for both reading schemes,
the site build stops with an error similar to:

```text
The reading-font subset is stale (U+....). Run scripts/build-fonts.py before publishing.
```

This is intentional: it prevents a newly introduced out-of-plan Chinese,
Latin, Greek, mathematical, arrow, box-drawing, or other reading character from silently
creating an unreviewed system-font fallback. The existing published site
remains unchanged if the publishing workflow fails.

You do not need to determine manually whether an entry contains new
characters. Run the normal site build; update the subsets only if it reports
that they are stale.

## Planned Chinese coverage

`scripts/tongyong-guifan-hanzi-level-1.txt` and
`scripts/tongyong-guifan-hanzi-level-2.txt` are the reviewed, numbered sources
for the 3,500 first-level and 3,000 second-level Han characters. The build
validates each file's official sequence range, uniqueness, unified-ideograph
codepoint range, entry count, and SHA-256; it also rejects duplicates across
the two levels. The second-level table legitimately includes Extension A and
supplementary-plane ideographs, so it is not restricted to the Basic CJK
block.

The Wikisource transcription displays the superscript note labels `b1`–`b4`
after entries 5401 `皙`, 5903 `瞋`, 5910 `噘`, and 6333 `蹚`. Those labels are
annotations rather than characters in the table and are intentionally absent
from the numbered source file.

The Chinese font plan is monotonic: rebuilding takes the union of the existing
reviewed CJK set, both standard-Hanzi lists, and all CJK codepoints currently
used by the site. Unused reviewed characters are intentionally retained. The
site build therefore checks containment rather than requiring the current text
and font cmap to be identical.

The initial common-Hanzi expansion retained all 2,916 previously covered CJK
codepoints. Of the 3,500 first-level characters, 2,652 were already present
and 848 were added, producing a 3,764-codepoint planned CJK set.

Before the second-level expansion, the reviewed plan contained 3,765 CJK
codepoints. Of the 3,000 second-level characters, 216 were already present and
2,784 were added, producing the current 6,549-codepoint planned CJK set.

## Typography strategies covered

The site has two selectable typography strategies, and this workflow covers
both of them:

- `iming-garamond` is the default. It uses the EB Garamond-derived Daodao
  Garamond subset for Latin text and the I.MingCP-derived Daodao Ming subset
  for Chinese text. A tiny Daodao Serif Supplement supplies reviewed gaps.
  The `--garamond`, `--iming`, and `--noto-serif-cjk` inputs rebuild these
  fonts.
- `noto-system` uses the existing Noto Serif files for Latin text. For Chinese
  text, it prefers the locally installed Songti SC on Apple platforms and uses
  the self-hosted Daodao Noto Serif SC subset as a fallback. The same Daodao
  Serif Supplement closes reviewed gaps before the stack reaches a system
  font. The `--noto-serif-cjk` input rebuilds both of those derived files. The
  existing Latin Noto Serif files and the operating system's Songti SC are not
  regenerated; Noto Serif 300 is nevertheless hashed and included in the
  coverage manifest.

The current deliberate coverage additions are documented in
`assets/fonts/README.md`: Daodao Garamond adds `π`, `→`, and `−`, while the
supplement contains exactly `ǐ`, `π`, `→`, `⇌`, and `└`.

The `redacted` and `raw` build modes control which diary and swimming-record
text is published; they are separate from these two typography strategies.
Every site build validates the font assets needed by both typography
strategies.

## Before starting

- Finish the current diary, swimming-record, and redaction edits first. A later
  first- or second-level Han character is already covered; other new characters
  may still require rebuilding the subsets.
- Run all commands from the repository root.
- Python 3, Node.js, `curl`, and network access are required.
- Do not use the `--accept-different-sources` option. The source-hash checks
  protect the site from accidentally switching to different fonts.

## 1. Check whether an update is needed

```sh
FONT_WORK=/tmp/daodao-font-work

mkdir -p "$FONT_WORK"
node scripts/build-site.mjs \
  --mode redacted \
  --output "$FONT_WORK/site-check"
```

If the build succeeds, the subsets are current and no font update is needed.
If it reports that the reading-font subset is stale, continue below.

## 2. Prepare the pinned font-building tools

The virtual environment and full upstream fonts are kept under `/tmp`, so
they will not be committed to the repository.

```sh
python3 -m venv "$FONT_WORK/venv"
"$FONT_WORK/venv/bin/python" -m pip install \
  -r scripts/requirements-fonts.txt
```

## 3. Download the pinned upstream fonts

```sh
curl --fail --location \
  --output "$FONT_WORK/I.MingCP-8.10.ttf" \
  "https://raw.githubusercontent.com/ichitenfont/I.Ming/55fcbf7ffeee83046a94a087bfa88841358e09de/8.10/I.MingCP-8.10.ttf"

curl --fail --location \
  --output "$FONT_WORK/EBGaramond-wght.ttf" \
  "https://raw.githubusercontent.com/google/fonts/f8c1d3d6cc75e30d77130bdcbfbff27e3b6233fe/ofl/ebgaramond/EBGaramond%5Bwght%5D.ttf"

curl --fail --location \
  --output "$FONT_WORK/NotoSerifCJKsc-Light.otf" \
  "https://raw.githubusercontent.com/notofonts/noto-cjk/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Serif/OTF/SimplifiedChinese/NotoSerifCJKsc-Light.otf"
```

These URLs and their expected SHA-256 hashes are also documented in
`assets/fonts/README.md` and enforced by `scripts/build-fonts.py`. If the
project deliberately updates an upstream font in the future, update this
guide at the same time.

## 4. Rebuild the subsets

```sh
"$FONT_WORK/venv/bin/python" scripts/build-fonts.py \
  --iming "$FONT_WORK/I.MingCP-8.10.ttf" \
  --garamond "$FONT_WORK/EBGaramond-wght.ttf" \
  --noto-serif-cjk "$FONT_WORK/NotoSerifCJKsc-Light.otf"
```

The script validates the upstream hashes before replacing anything. It then
rebuilds the subsets from the same font families and updates the cache hashes.
It does not change the site's selected typefaces.

Depending on which characters were added, the expected tracked changes are:

- `assets/fonts/daodao-ming-regular.woff2`
- `assets/fonts/daodao-noto-serif-sc-light.woff2`
- `assets/fonts/daodao-serif-supplement.woff2`
- `scripts/font-subset-manifest.json`
- `style.css`
- `typography.js`

The Garamond subset normally remains unchanged when only Chinese characters
were added. The five-codepoint supplement also remains unchanged unless its
explicit reviewed set is changed.

## 5. Verify the result

```sh
node scripts/build-site.mjs \
  --mode redacted \
  --output "$FONT_WORK/site-redacted"

node scripts/build-site.mjs \
  --mode raw \
  --output "$FONT_WORK/site-raw"

git diff --check
git status --short
git diff --stat
```

Both builds should finish with a `Built ... site` message and no stale-font
error. Review `git status` and confirm that every listed change is intended.

For an optional visual check, serve the generated redacted site locally:

```sh
python3 -m http.server 8000 --directory "$FONT_WORK/site-redacted"
```

While the server is running, open both typography strategies in a browser:

- <http://localhost:8000/?typography=iming-garamond>
- <http://localhost:8000/?typography=noto-system>

Check that the new characters appear correctly and that the surrounding text
still has the expected appearance. The build already proves that the current
reading codepoints are covered by each scheme's declared self-hosted fonts;
this browser pass checks the actual CSS routing and visual fit. On Apple
platforms, `noto-system` normally uses the locally installed Songti SC for
Chinese and loads the self-hosted Daodao Noto Serif SC subset only as needed.
Stop the local server with
Control-C when the check is complete. If port 8000 is already in use, choose
another port and use the same port in the two URLs.

## 6. Commit

If `git status` contains only the intended tracked changes, they can be
committed together with the diary entry and any redaction updates:

```sh
git commit -am "Add diary entry and refresh font subsets"
```

`git commit -a` includes modified and deleted tracked files, but not untracked
files. If any intended file is untracked, add it explicitly before committing.

## Why not ship the complete Chinese fonts?

The full I.MingCP and Noto Serif CJK source fonts are each tens of megabytes.
The planned-coverage WOFF2 subsets are much smaller, improving initial page
loading and mobile data use while keeping typography consistent across
platforms. The exact planned-CJK comparison, first- and second-level source
validation, and full reading-scheme coverage checks are the safeguards that
make this approach reliable.
