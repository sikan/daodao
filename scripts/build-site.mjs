#!/usr/bin/env node

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const defaultOutputDirectory = resolve(repositoryRoot, "_site");
const publicFiles = [
  ".nojekyll",
  "index.html",
  "app.js",
  "style.css",
  "robots.txt",
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

async function build() {
  const options = parseOptions(process.argv.slice(2));
  const outputDirectory = resolve(options.output);

  validateOutputDirectory(outputDirectory);
  await rm(outputDirectory, { recursive: true, force: true });
  await copyPublicFiles(outputDirectory);

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
