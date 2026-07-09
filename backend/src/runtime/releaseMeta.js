/**
 * FT-DEP-001 Batch 2 — read Batch 1 VERSION.txt / package version metadata.
 */
const fs = require("fs");
const path = require("path");
const { getPackageRoot } = require("./paths");

/**
 * @param {string} text
 * @returns {Record<string, string>}
 */
function parseVersionTxt(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

/**
 * @param {string|null} versionFile
 */
function loadReleaseMetadata(versionFile) {
  let productVersion = null;
  let buildDate = null;
  let gitCommit = null;
  let prismaMigrationHead = null;
  let releaseFolder = null;
  let source = "package.json";

  try {
    const pkg = require(path.join(getPackageRoot(), "package.json"));
    if (pkg?.version) productVersion = String(pkg.version);
  } catch {
    // ignore
  }

  if (versionFile && fs.existsSync(versionFile)) {
    try {
      const parsed = parseVersionTxt(fs.readFileSync(versionFile, "utf8"));
      source = versionFile;
      if (parsed.productVersion) productVersion = parsed.productVersion;
      if (parsed.buildDate) buildDate = parsed.buildDate;
      if (parsed.gitCommit) gitCommit = parsed.gitCommit;
      if (parsed.prismaMigrationHead) prismaMigrationHead = parsed.prismaMigrationHead;
      if (parsed.releaseFolder) releaseFolder = parsed.releaseFolder;
    } catch {
      // keep package.json fallback
    }
  }

  if (!productVersion) productVersion = "0.0.0";

  return {
    productVersion,
    buildDate,
    gitCommit,
    prismaMigrationHead,
    releaseFolder,
    source,
  };
}

module.exports = { parseVersionTxt, loadReleaseMetadata };
