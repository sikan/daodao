# Font assets

The site self-hosts its fonts so the reading experience does not depend on
fonts installed by Windows, macOS, or iOS. The typography schemes use
content-specific WOFF2 subsets in this directory. Their much larger upstream
I.MingCP, EB Garamond, and Noto Serif CJK source files are intentionally not
committed.

## Reading fonts

### Daodao Ming Regular

`daodao-ming-regular.woff2` is a content-specific subset derived from
I.MingCP 8.10. I.MingCP uses centered full-width punctuation and is published
under the IPA Font License Agreement v1.0.

- Upstream project: <https://github.com/ichitenfont/I.Ming>
- Pinned source commit: `55fcbf7ffeee83046a94a087bfa88841358e09de`
- Original file: `8.10/I.MingCP-8.10.ttf`
- Pinned download: <https://raw.githubusercontent.com/ichitenfont/I.Ming/55fcbf7ffeee83046a94a087bfa88841358e09de/8.10/I.MingCP-8.10.ttf>
- Original SHA-256: `1c411a2e97b65c26aaa01707bbe06919569fcd7683c8bb5db114a96264710458`
- License: `I.MingCP-IPA-FONT-LICENSE.md` (official Japanese/English text)
- Official Chinese translation: `LICENSE_CHI.md`

Subsetting creates a Derived Program under the IPA Font License. The derived
program therefore uses the distinct family name `Daodao Ming`, the distinct
PostScript name `DaodaoMing-Regular`, and a filename that does not contain the
upstream font name.

To replace the derived font with the Original Program, download the pinned
`I.MingCP-8.10.ttf`, copy it into this directory without modifying or renaming
it, and change the `Daodao Ming` `@font-face` source in `style.css` to:

```css
src: url("./assets/fonts/I.MingCP-8.10.ttf") format("truetype");
```

The CSS family descriptor may remain `Daodao Ming`; it is an application alias
and does not modify the Original Program. Keep the IPA license alongside the
font when redistributing it.

### Daodao Garamond Regular

`daodao-garamond-roman.woff2` is a Latin-focused subset of the EB Garamond
1.003 variable roman font. It retains the 400–800 weight axis and is published
under the SIL Open Font License 1.1.

- Upstream project: <https://github.com/octaviopardo/EBGaramond12>
- Distribution source: <https://github.com/google/fonts/tree/main/ofl/ebgaramond>
- Pinned distribution commit: `f8c1d3d6cc75e30d77130bdcbfbff27e3b6233fe`
- Original file: `EBGaramond[wght].ttf`
- Pinned download: <https://raw.githubusercontent.com/google/fonts/f8c1d3d6cc75e30d77130bdcbfbff27e3b6233fe/ofl/ebgaramond/EBGaramond%5Bwght%5D.ttf>
- Original SHA-256: `ef9512f92f6d579e5dc75af59a5a4b1b8b47d2eda89e00b954d44520e5369027`
- License: `EB-Garamond-OFL.txt`

## UI font

`noto-sans-400.ttf` contains the Latin UI face used by the ordering controls
and year rail. It is covered by `OFL.txt` (Noto Project Authors, OFL 1.1).

## Legacy reading fonts

The five `noto-serif-*.ttf` files preserve the site's earlier Latin reading
family for the `noto-system` typography scheme. These files are covered by
`OFL.txt`.

### Daodao Noto Serif SC Light

`daodao-noto-serif-sc-light.woff2` is a content-specific Chinese subset of
Noto Serif CJK SC 2.003 Light. It supplies the CJK glyphs missing from the
legacy Latin-only Noto Serif files, so the alternate scheme remains serif on
iOS and other platforms without relying on locally installed fonts.

- Upstream project: <https://github.com/notofonts/noto-cjk>
- Version: Noto Serif CJK 2.003
- Pinned source commit: `f8d157532fbfaeda587e826d4cd5b21a49186f7c`
- Original file: `Serif/OTF/SimplifiedChinese/NotoSerifCJKsc-Light.otf`
- Pinned download: <https://raw.githubusercontent.com/notofonts/noto-cjk/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Serif/OTF/SimplifiedChinese/NotoSerifCJKsc-Light.otf>
- Original SHA-256: `7da07efb309a89b156090848aab55d9dc57f15b08387b51184b08b89501a382c`
- License: `OFL.txt`

The subset uses the distinct internal family name `Daodao Noto Serif SC` and
PostScript name `DaodaoNotoSerifSC-Light`.

The alternate typography scheme first asks Apple platforms for their locally
installed `Songti SC Light` (`STSongti-SC-Light`) to reproduce the original
macOS rendering without redistributing an Apple system font. This self-hosted
Noto Serif CJK subset remains the serif fallback for platforms where Songti SC
is unavailable; that fallback retains its own lighter ink compensation.

## Rebuilding the subsets

Install the pinned tooling in an isolated Python environment:

```sh
python -m pip install -r scripts/requirements-fonts.txt
```

Download the three pinned source files above, then run from the repository
root:

```sh
python scripts/build-fonts.py \
  --iming /path/to/I.MingCP-8.10.ttf \
  --garamond '/path/to/EBGaramond[wght].ttf' \
  --noto-serif-cjk /path/to/NotoSerifCJKsc-Light.otf
```

The script validates the upstream source hashes, renames the derived fonts,
writes deterministic WOFF2 subsets, and updates
`scripts/font-subset-manifest.json`. Font files are staged first, and every
expected reference is validated before the generated files, manifest, or
content-hash query strings are replaced. The normal site build checks the
manifest against all diary and interface text and fails if a newly introduced
CJK character is absent.
