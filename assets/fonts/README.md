# Font assets

The site self-hosts its fonts so the default reading experience does not
depend on fonts installed by Windows, macOS, or iOS. The default scheme uses
the two content-specific WOFF2 subsets in this directory. Their much larger
upstream I.MingCP and EB Garamond source files are intentionally not committed;
the alternate legacy scheme retains the site's existing Noto Serif TTF files.

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
family for the `noto-system` typography scheme. Chinese characters in that
scheme continue through the platform serif fallback stack. These files are
also covered by `OFL.txt`.

## Rebuilding the subsets

Install the pinned tooling in an isolated Python environment:

```sh
python -m pip install -r scripts/requirements-fonts.txt
```

Download the two pinned source files above, then run from the repository root:

```sh
python scripts/build-fonts.py \
  --iming /path/to/I.MingCP-8.10.ttf \
  --garamond '/path/to/EBGaramond[wght].ttf'
```

The script validates the upstream source hashes, renames the derived fonts,
writes deterministic WOFF2 subsets, and updates
`scripts/font-subset-manifest.json`. It also updates the content-hash query
strings in `typography.js` and `style.css`, preventing stale browser caches
after a subset changes. The normal site build checks the manifest against all
diary and interface text and fails if a newly introduced CJK character is
absent.
