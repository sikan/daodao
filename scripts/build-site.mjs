#!/usr/bin/env node

import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const defaultOutputDirectory = resolve(repositoryRoot, "_site");
const publicFiles = [
  ".nojekyll",
  "_headers",
  "index.html",
  "typography.js",
  "app.js",
  "style.css",
  "robots.txt",
];
const versionedPublicAssets = ["typography.js", "style.css", "app.js"];
const fontManifestPath = resolve(
  repositoryRoot,
  "scripts",
  "font-subset-manifest.json"
);
const fontDirectory = resolve(repositoryRoot, "assets", "fonts");
const cjkUnicodeRanges = [
  [0x2000, 0x206f],
  [0x2e80, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe1f],
  [0xfe30, 0xfe4f],
  [0xff00, 0xffef],
  [0x20000, 0x2fa1f],
  [0x2ebf0, 0x2ee5f],
  [0x30000, 0x323af],
];
const cjkSeed = "，。！？：；、‧·—…“”‘’（）《》〈〉【】〔〕［］｛｝";
const standardHanziRequirements = [
  {
    level: 1,
    file: "scripts/tongyong-guifan-hanzi-level-1.txt",
    sequenceStart: 1,
    entries: 3500,
  },
  {
    level: 2,
    file: "scripts/tongyong-guifan-hanzi-level-2.txt",
    sequenceStart: 3501,
    entries: 3000,
  },
];
const hanziUnicodeRanges = [
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0x20000, 0x2fa1f],
  [0x2ebf0, 0x2ee5f],
  [0x30000, 0x323af],
];

function parseOptions(argumentsList) {
  const options = {
    mode: "redacted",
    output: defaultOutputDirectory,
  };

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];

    if (argument === "--mode" || argument === "--output") {
      const value = argumentsList[index + 1];

      if (!value) {
        throw new Error(`${argument} requires a value`);
      }

      if (argument === "--mode") {
        options.mode = value;
      } else {
        options.output = resolve(repositoryRoot, value);
      }

      index += 1;
      continue;
    }

    if (argument.startsWith("--mode=")) {
      options.mode = argument.slice("--mode=".length);
      continue;
    }

    if (argument.startsWith("--output=")) {
      options.output = resolve(
        repositoryRoot,
        argument.slice("--output=".length)
      );
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!["redacted", "raw"].includes(options.mode)) {
    throw new Error("--mode must be either redacted or raw");
  }

  return options;
}

function isInside(parentPath, childPath) {
  const pathFromParent = relative(parentPath, childPath);

  return (
    pathFromParent === "" ||
    (!pathFromParent.startsWith(`..${sep}`) &&
      pathFromParent !== ".." &&
      !isAbsolute(pathFromParent))
  );
}

function validateOutputDirectory(outputDirectory) {
  if (isInside(outputDirectory, repositoryRoot)) {
    throw new Error("The output directory cannot contain the repository");
  }

  if (
    isInside(repositoryRoot, outputDirectory) &&
    outputDirectory !== defaultOutputDirectory
  ) {
    throw new Error("The only allowed output directory inside the repository is _site");
  }
}

function characterLength(value) {
  return Array.from(value).length;
}

function isCjkCodepoint(codepoint) {
  return cjkUnicodeRanges.some(
    ([rangeStart, rangeEnd]) =>
      codepoint >= rangeStart && codepoint <= rangeEnd
  );
}

function isHanziCodepoint(codepoint) {
  return hanziUnicodeRanges.some(
    ([rangeStart, rangeEnd]) =>
      codepoint >= rangeStart && codepoint <= rangeEnd
  );
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function formatCodepoint(codepoint) {
  return `U+${codepoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

function parseCodepointLabels(labels, fieldName) {
  if (!Array.isArray(labels)) {
    throw new Error(`${fieldName} must be an array`);
  }

  const codepoints = labels.map((label) => {
    if (typeof label !== "string" || !/^U\+[0-9A-F]{4,6}$/.test(label)) {
      throw new Error(`Invalid codepoint label in ${fieldName}: ${label}`);
    }

    return Number.parseInt(label.slice(2), 16);
  });

  for (let index = 1; index < codepoints.length; index += 1) {
    if (codepoints[index] <= codepoints[index - 1]) {
      throw new Error(`${fieldName} must be unique and sorted`);
    }
  }

  return new Set(codepoints);
}

function parseStandardHanzi(contents, sourcePath, sequenceStart) {
  const codepoints = new Set();
  let expectedSequence = sequenceStart;

  for (const [lineIndex, rawLine] of contents.split(/\r?\n/).entries()) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = /^(\d{4}) (.)$/u.exec(line);

    if (!match) {
      throw new Error(
        `Invalid standard Hanzi entry at ${sourcePath}:${lineIndex + 1}`
      );
    }

    const sequence = Number.parseInt(match[1], 10);

    if (sequence !== expectedSequence) {
      throw new Error(
        `Unexpected common Hanzi sequence ${match[1]}; ` +
          `expected ${String(expectedSequence).padStart(4, "0")}`
      );
    }

    const codepoint = match[2].codePointAt(0);

    if (!isHanziCodepoint(codepoint)) {
      throw new Error(
        `Standard Hanzi entry is not a unified ideograph at ` +
          `${sourcePath}:${lineIndex + 1}: ${formatCodepoint(codepoint)}`
      );
    }

    if (codepoints.has(codepoint)) {
      throw new Error(
        `Duplicate standard Hanzi entry in ${sourcePath}: ` +
          formatCodepoint(codepoint)
      );
    }

    codepoints.add(codepoint);
    expectedSequence += 1;
  }

  return codepoints;
}

function setDifference(left, right) {
  return new Set([...left].filter((value) => !right.has(value)));
}

function describeCodepoints(codepoints) {
  return [...codepoints]
    .sort((left, right) => left - right)
    .slice(0, 12)
    .map(formatCodepoint)
    .join(", ");
}

function resolveFontAsset(relativeFontPath) {
  const fontPath = resolve(repositoryRoot, relativeFontPath);

  if (!isInside(fontDirectory, fontPath)) {
    throw new Error(`Font reference escapes assets/fonts: ${relativeFontPath}`);
  }

  return fontPath;
}

async function validateFontAssets() {
  const manifest = JSON.parse(await readFile(fontManifestPath, "utf8"));

  if (
    manifest.version !== 5 ||
    !Array.isArray(manifest.textSources) ||
    !Array.isArray(manifest.cjkCodepoints) ||
    !Array.isArray(manifest.standardHanzi) ||
    manifest.standardHanzi.length !== standardHanziRequirements.length ||
    !manifest.readingSchemes ||
    !manifest.fonts?.ming ||
    !manifest.fonts?.garamond ||
    !manifest.fonts?.serifSupplement ||
    !manifest.fonts?.notoSerif300 ||
    !manifest.fonts?.notoSerifCjk
  ) {
    throw new Error("Invalid scripts/font-subset-manifest.json");
  }

  for (const schemeName of ["iming-garamond", "noto-system"]) {
    if (!Array.isArray(manifest.readingSchemes[schemeName])) {
      throw new Error(`Missing reading scheme in font manifest: ${schemeName}`);
    }
  }

  const sourceText = (
    await Promise.all(
      manifest.textSources.map((sourcePath) =>
        readFile(resolve(repositoryRoot, sourcePath), "utf8")
      )
    )
  ).join("");
  const seededSourceText = cjkSeed + sourceText;
  const requiredReadingCodepoints = new Set(
    Array.from(seededSourceText)
      .filter((character) => !/\p{C}/u.test(character))
      .map((character) => character.codePointAt(0))
  );
  const requiredCjkCodepoints = new Set(
    [...requiredReadingCodepoints].filter(isCjkCodepoint)
  );
  const manifestCjkCodepoints = parseCodepointLabels(
    manifest.cjkCodepoints,
    "cjkCodepoints"
  );
  const nonCjkManifestCodepoints = new Set(
    [...manifestCjkCodepoints].filter((codepoint) => !isCjkCodepoint(codepoint))
  );

  if (nonCjkManifestCodepoints.size > 0) {
    throw new Error(
      `cjkCodepoints contains non-CJK values ` +
        `(${describeCodepoints(nonCjkManifestCodepoints)})`
    );
  }

  const standardHanziCodepoints = new Set();

  for (const [index, requirement] of standardHanziRequirements.entries()) {
    const source = manifest.standardHanzi[index];

    if (
      source?.level !== requirement.level ||
      source?.file !== requirement.file ||
      source?.sequenceStart !== requirement.sequenceStart ||
      source?.entries !== requirement.entries ||
      typeof source?.file !== "string" ||
      typeof source?.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(source.sha256)
    ) {
      throw new Error(
        `Invalid level-${requirement.level} standard Hanzi manifest entry`
      );
    }

    const sourcePath = resolve(repositoryRoot, source.file);

    if (!isInside(scriptDirectory, sourcePath)) {
      throw new Error(`Standard Hanzi source escapes scripts: ${source.file}`);
    }

    const contents = await readFile(sourcePath);

    if (sha256(contents) !== source.sha256) {
      throw new Error(
        `Standard Hanzi source does not match its manifest: ${source.file}. ` +
          "Run scripts/build-fonts.py before publishing."
      );
    }

    const sourceCodepoints = parseStandardHanzi(
      contents.toString("utf8"),
      source.file,
      source.sequenceStart
    );

    if (sourceCodepoints.size !== source.entries) {
      throw new Error(
        `The level-${source.level} standard Hanzi source must contain ` +
          `exactly ${source.entries} entries`
      );
    }

    for (const codepoint of sourceCodepoints) {
      if (standardHanziCodepoints.has(codepoint)) {
        throw new Error(
          `Duplicate standard Hanzi entry across levels: ` +
            formatCodepoint(codepoint)
        );
      }

      standardHanziCodepoints.add(codepoint);
    }
  }

  const missingRequiredCjkCodepoints = setDifference(
    requiredCjkCodepoints,
    manifestCjkCodepoints
  );
  const missingStandardHanziCodepoints = setDifference(
    standardHanziCodepoints,
    manifestCjkCodepoints
  );

  if (
    missingRequiredCjkCodepoints.size > 0 ||
    missingStandardHanziCodepoints.size > 0
  ) {
    const labels = describeCodepoints(
      new Set([
        ...missingRequiredCjkCodepoints,
        ...missingStandardHanziCodepoints,
      ])
    );
    throw new Error(
      `The reading-font subset is stale (${labels}). ` +
        "Run scripts/build-fonts.py before publishing."
    );
  }

  const fontReferenceSources = await Promise.all(
    ["typography.js", "style.css"].map(async (sourcePath) => ({
      sourcePath,
      contents: await readFile(resolve(repositoryRoot, sourcePath), "utf8"),
    }))
  );

  const fontCodepoints = new Map();

  for (const [fontKey, font] of Object.entries(manifest.fonts)) {
    if (
      typeof font?.file !== "string" ||
      typeof font?.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(font.sha256) ||
      !Number.isInteger(font.bytes) ||
      typeof font.preload !== "boolean"
    ) {
      throw new Error(`Invalid font manifest entry: ${fontKey}`);
    }

    const fontPath = resolveFontAsset(font.file);
    const contents = await readFile(fontPath);

    if (contents.byteLength !== font.bytes || sha256(contents) !== font.sha256) {
      throw new Error(
        `Font asset does not match its manifest: ${font.file}. ` +
          "Run scripts/build-fonts.py before publishing."
      );
    }

    const filename = font.file.split("/").at(-1);
    const versionedReference = `${filename}?v=${font.sha256.slice(0, 12)}`;

    const stylesheetSource = fontReferenceSources.find(
      (source) => source.sourcePath === "style.css"
    );

    if (!stylesheetSource.contents.includes(versionedReference)) {
      throw new Error(
        `${stylesheetSource.sourcePath} is missing ${versionedReference}. ` +
          "Run scripts/build-fonts.py before publishing."
      );
    }

    if (
      font.preload &&
      !fontReferenceSources
        .find((source) => source.sourcePath === "typography.js")
        .contents.includes(versionedReference)
    ) {
      throw new Error(
        `typography.js is missing ${versionedReference}. ` +
          "Run scripts/build-fonts.py before publishing."
      );
    }

    let declaredCodepoints;

    if (font.codepointSet === "cjk") {
      declaredCodepoints = manifestCjkCodepoints;
    } else {
      declaredCodepoints = parseCodepointLabels(
        font.codepoints,
        `fonts.${fontKey}.codepoints`
      );
    }

    if (font.glyphCodepoints !== declaredCodepoints.size) {
      throw new Error(`Incorrect glyphCodepoints for font: ${fontKey}`);
    }

    fontCodepoints.set(fontKey, declaredCodepoints);
  }

  for (const [schemeName, schemeFonts] of Object.entries(
    manifest.readingSchemes
  )) {
    if (!Array.isArray(schemeFonts) || schemeFonts.length === 0) {
      throw new Error(`Invalid reading scheme: ${schemeName}`);
    }

    const schemeCodepoints = new Set();

    for (const fontKey of schemeFonts) {
      if (!fontCodepoints.has(fontKey)) {
        throw new Error(
          `Reading scheme ${schemeName} references unknown font: ${fontKey}`
        );
      }

      for (const codepoint of fontCodepoints.get(fontKey)) {
        schemeCodepoints.add(codepoint);
      }
    }

    const uncoveredCodepoints = setDifference(
      requiredReadingCodepoints,
      schemeCodepoints
    );

    if (uncoveredCodepoints.size > 0) {
      throw new Error(
        `Reading scheme ${schemeName} would use an unplanned system fallback ` +
          `(${describeCodepoints(uncoveredCodepoints)}). ` +
          "Run scripts/build-fonts.py or update the reviewed font plan."
      );
    }
  }

  const stylesheet = fontReferenceSources.find(
    (source) => source.sourcePath === "style.css"
  ).contents;
  const typographyScript = fontReferenceSources.find(
    (source) => source.sourcePath === "typography.js"
  ).contents;
  const stylesheetFontMatches = stylesheet.matchAll(
    /url\(["']?(\.\/assets\/fonts\/[^"'?]+\.(?:ttf|woff2))/g
  );
  const stylesheetFontPaths = new Set(
    [...stylesheetFontMatches].map((match) => match[1])
  );
  const preloadFontMatches = typographyScript.matchAll(
    /href:\s*["'](\.\/assets\/fonts\/[^"'?]+\.(?:ttf|woff2))/g
  );
  const preloadFontPaths = new Set(
    [...preloadFontMatches].map((match) => match[1])
  );

  if (stylesheetFontPaths.size === 0 || preloadFontPaths.size === 0) {
    throw new Error("No typography font assets were found to validate");
  }

  for (const relativeFontPath of stylesheetFontPaths) {
    await readFile(resolveFontAsset(relativeFontPath));
  }

  for (const preloadFontPath of preloadFontPaths) {
    if (!stylesheetFontPaths.has(preloadFontPath)) {
      throw new Error(
        `Preloaded font has no matching @font-face: ${preloadFontPath}`
      );
    }
  }
}

function validateRedactionConfig(config) {
  if (
    !config ||
    config.version !== 1 ||
    !Array.isArray(config.replacements)
  ) {
    throw new Error("redactions.json must contain version 1 and a replacements array");
  }

  const sources = new Set();

  config.replacements.forEach((replacement, index) => {
    const rowNumber = index + 1;

    if (
      !replacement ||
      typeof replacement.from !== "string" ||
      replacement.from.length === 0 ||
      typeof replacement.to !== "string" ||
      replacement.to.length === 0
    ) {
      throw new Error(`Invalid redaction entry at row ${rowNumber}`);
    }

    if (replacement.from === replacement.to) {
      throw new Error(`Redaction row ${rowNumber} does not change its source`);
    }

    if (sources.has(replacement.from)) {
      throw new Error(`Duplicate redaction source at row ${rowNumber}`);
    }

    sources.add(replacement.from);
  });

  const sourceList = [...sources];

  config.replacements.forEach((replacement, index) => {
    if (sourceList.some((source) => replacement.to.includes(source))) {
      throw new Error(
        `Redaction target at row ${index + 1} contains another source name`
      );
    }
  });
}

function applyRedactions(source, replacements) {
  const orderedReplacements = replacements
    .map((replacement, index) => ({ ...replacement, index }))
    .sort(
      (left, right) =>
        characterLength(right.from) - characterLength(left.from) ||
        left.index - right.index
    );

  let output = source;
  let replacementCount = 0;

  for (const replacement of orderedReplacements) {
    const parts = output.split(replacement.from);
    replacementCount += parts.length - 1;
    output = parts.join(replacement.to);
  }

  const remainingSourceCount = orderedReplacements.filter((replacement) =>
    output.includes(replacement.from)
  ).length;

  if (remainingSourceCount > 0) {
    throw new Error(
      `Redaction verification failed for ${remainingSourceCount} source entries`
    );
  }

  return {
    output,
    replacementCount,
  };
}

async function copyPublicFiles(outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });

  for (const filename of publicFiles) {
    await cp(
      resolve(repositoryRoot, filename),
      resolve(outputDirectory, filename)
    );
  }

  await cp(
    resolve(repositoryRoot, "assets"),
    resolve(outputDirectory, "assets"),
    { recursive: true }
  );
}

async function versionPublicAssetReferences(outputDirectory) {
  const indexPath = resolve(outputDirectory, "index.html");
  let index = await readFile(indexPath, "utf8");

  for (const filename of versionedPublicAssets) {
    const reference = `./${filename}`;

    if (!index.includes(reference)) {
      throw new Error(`index.html is missing ${reference}`);
    }

    const contents = await readFile(resolve(outputDirectory, filename));
    const versionedReference = `${reference}?v=${sha256(contents).slice(0, 12)}`;
    index = index.replaceAll(reference, versionedReference);
  }

  await writeFile(indexPath, index, "utf8");
}

async function build() {
  const options = parseOptions(process.argv.slice(2));
  const outputDirectory = resolve(options.output);

  validateOutputDirectory(outputDirectory);
  await validateFontAssets();
  await rm(outputDirectory, { recursive: true, force: true });
  await copyPublicFiles(outputDirectory);
  await versionPublicAssetReferences(outputDirectory);

  const sourceDiary = await readFile(
    resolve(repositoryRoot, "daodao.master.txt"),
    "utf8"
  );
  const sourceSwimming = await readFile(
    resolve(repositoryRoot, "every-lap-counts.master.txt"),
    "utf8"
  );

  let publicDiary = sourceDiary;
  let publicSwimming = sourceSwimming;
  let replacementCount = 0;

  if (options.mode === "redacted") {
    const config = JSON.parse(
      await readFile(resolve(repositoryRoot, "redactions.json"), "utf8")
    );

    validateRedactionConfig(config);

    const redacted = applyRedactions(sourceDiary, config.replacements);
    const redactedSwimming = applyRedactions(
      sourceSwimming,
      config.replacements
    );
    publicDiary = redacted.output;
    publicSwimming = redactedSwimming.output;
    replacementCount =
      redacted.replacementCount + redactedSwimming.replacementCount;
  }

  await writeFile(
    resolve(outputDirectory, "daodao.txt"),
    publicDiary,
    "utf8"
  );
  await writeFile(
    resolve(outputDirectory, "every-lap-counts.txt"),
    publicSwimming,
    "utf8"
  );

  console.log(
    `Built ${options.mode} site with ${replacementCount} replacements in ${outputDirectory}`
  );
}

build().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
