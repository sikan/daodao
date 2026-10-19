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

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
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
    manifest.version !== 2 ||
    !Array.isArray(manifest.textSources) ||
    !Array.isArray(manifest.cjkCodepoints) ||
    !manifest.fonts?.ming ||
    !manifest.fonts?.garamond ||
    !manifest.fonts?.notoSerifCjk
  ) {
    throw new Error("Invalid scripts/font-subset-manifest.json");
  }

  const sourceText = (
    await Promise.all(
      manifest.textSources.map((sourcePath) =>
        readFile(resolve(repositoryRoot, sourcePath), "utf8")
      )
    )
  ).join("");
  const includedCodepoints = new Set(
    manifest.cjkCodepoints.map((label) => Number.parseInt(label.slice(2), 16))
  );
  const missingCodepoints = [
    ...new Set(
      Array.from(sourceText, (character) => character.codePointAt(0)).filter(
        (codepoint) =>
          isCjkCodepoint(codepoint) && !includedCodepoints.has(codepoint)
      )
    ),
  ].sort((left, right) => left - right);

  if (missingCodepoints.length > 0) {
    const labels = missingCodepoints
      .slice(0, 12)
      .map((codepoint) => `U+${codepoint.toString(16).toUpperCase()}`)
      .join(", ");
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

  for (const [fontKey, font] of Object.entries(manifest.fonts)) {
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
      fontKey !== "notoSerifCjk" &&
      !fontReferenceSources
        .find((source) => source.sourcePath === "typography.js")
        .contents.includes(versionedReference)
    ) {
      throw new Error(
        `typography.js is missing ${versionedReference}. ` +
          "Run scripts/build-fonts.py before publishing."
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

  let publicDiary = sourceDiary;
  let replacementCount = 0;

  if (options.mode === "redacted") {
    const config = JSON.parse(
      await readFile(resolve(repositoryRoot, "redactions.json"), "utf8")
    );

    validateRedactionConfig(config);

    const redacted = applyRedactions(sourceDiary, config.replacements);
    publicDiary = redacted.output;
    replacementCount = redacted.replacementCount;
  }

  await writeFile(
    resolve(outputDirectory, "daodao.txt"),
    publicDiary,
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
