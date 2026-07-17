/**
 * FT-DEP-001 Milestone 4 — assemble commercial customer delivery media.
 *
 * Reuses: create-release package, Inno installer, handover docs, demo pack.
 * Does not redesign deployment engines or ERP workflows.
 *
 * Usage:
 *   node deployment/create-customer-media.js [--skip-installer] [--skip-zip] [--out <dir>]
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DEPLOY = __dirname;

function parseArgs(argv) {
  const out = {
    skipInstaller: false,
    skipZip: false,
    out: null,
    skipCreateRelease: true, // never rebuild release unless --rebuild-release
    rebuildRelease: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--skip-installer") out.skipInstaller = true;
    else if (a === "--skip-zip") out.skipZip = true;
    else if (a === "--rebuild-release") out.rebuildRelease = true;
    else if (a === "--out" && argv[i + 1]) out.out = path.resolve(argv[++i]);
  }
  return out;
}

function productVersion() {
  try {
    return require(path.join(ROOT, "backend", "package.json")).version || "1.0.0";
  } catch {
    return "1.0.0";
  }
}

function gitCommit() {
  const r = spawnSync("git", ["-C", ROOT, "rev-parse", "--short", "HEAD"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (r.status === 0) return String(r.stdout || "").trim() || "unknown";
  return "unknown";
}

function migrationHead(releaseDir) {
  const d = path.join(releaseDir, "prisma", "migrations");
  if (!fs.existsSync(d)) return "none";
  const names = fs
    .readdirSync(d, { withFileTypes: true })
    .filter((x) => x.isDirectory() && !x.name.startsWith("."))
    .map((x) => x.name)
    .sort();
  return names.length ? names[names.length - 1] : "none";
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return 0;
  ensureDir(dest);
  let n = 0;
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) n += copyDir(from, to);
    else if (ent.isFile()) {
      copyFile(from, to);
      n += 1;
    }
  }
  return n;
}

function writeText(filePath, text) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, text.endsWith("\n") ? text : text + "\n", "utf8");
}

function listFilesRecursive(dir, base = dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listFilesRecursive(full, base));
    else if (ent.isFile()) out.push(path.relative(base, full).replace(/\\/g, "/"));
  }
  return out.sort();
}

function zipDirectory(sourceDir, zipPath) {
  ensureDir(path.dirname(zipPath));
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  // PowerShell Compress-Archive — portable on Windows delivery hosts
  const ps = [
    `$ErrorActionPreference='Stop'`,
    `Compress-Archive -Path '${sourceDir.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
  ].join("; ");
  const r = spawnSync(
    "powershell",
    ["-NoProfile", "-Command", ps],
    { encoding: "utf8", windowsHide: true, timeout: 600000 },
  );
  if (r.status !== 0) {
    throw new Error(`Zip failed: ${r.stderr || r.stdout || r.error}`);
  }
  if (!fs.existsSync(zipPath)) throw new Error(`Zip not created: ${zipPath}`);
}

function runBat(batPath, args = []) {
  const r = spawnSync("cmd", ["/c", batPath, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: 1800000,
  });
  return r;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const version = productVersion();
  const releaseName = `Flowtix-v${version}`;
  const releaseDir = path.join(ROOT, "release", releaseName);
  const mediaName = `Flowtix-ERP-v${version}`;
  const outRoot =
    args.out || path.join(ROOT, "customer-media", mediaName);
  const buildDate = new Date().toISOString();
  const commit = gitCommit();

  console.log("[create-customer-media] Flowtix ERP commercial delivery");
  console.log(`  version=${version}`);
  console.log(`  commit=${commit}`);
  console.log(`  out=${outRoot}`);

  if (args.rebuildRelease) {
    console.log("[create-customer-media] Rebuilding release package...");
    const rel = runBat(path.join(DEPLOY, "create-release.bat"));
    if (rel.status !== 0) {
      console.error(rel.stdout);
      console.error(rel.stderr);
      process.exit(1);
    }
  }

  if (!fs.existsSync(path.join(releaseDir, "VERSION.txt"))) {
    console.error(`[create-customer-media] ERROR: missing ${releaseDir}\\VERSION.txt`);
    console.error("  Run deployment\\create-release.bat first (or --rebuild-release).");
    process.exit(1);
  }

  const installerSrc = path.join(
    DEPLOY,
    "installer",
    "output",
    `Flowtix-Setup-v${version}.exe`,
  );
  if (!args.skipInstaller) {
    if (!fs.existsSync(installerSrc)) {
      console.log("[create-customer-media] Building installer...");
      const inst = runBat(path.join(DEPLOY, "installer", "build-installer.bat"));
      if (inst.status !== 0 || !fs.existsSync(installerSrc)) {
        console.error(inst.stdout);
        console.error(inst.stderr);
        console.error("[create-customer-media] ERROR: installer build failed");
        process.exit(1);
      }
    }
  } else if (!fs.existsSync(installerSrc)) {
    console.error(`[create-customer-media] ERROR: installer missing: ${installerSrc}`);
    process.exit(1);
  }

  // Fresh media tree
  if (fs.existsSync(outRoot)) {
    fs.rmSync(outRoot, { recursive: true, force: true });
  }

  const dirs = {
    setup: path.join(outRoot, "01 Setup"),
    documentation: path.join(outRoot, "02 Documentation"),
    demo: path.join(outRoot, "03 Demo"),
    server: path.join(outRoot, "04 Server"),
    utilities: path.join(outRoot, "05 Utilities"),
    support: path.join(outRoot, "06 Support"),
    releaseNotes: path.join(outRoot, "07 Release Notes"),
    checksums: path.join(outRoot, "08 Checksums"),
    license: path.join(outRoot, "09 License"),
    manifest: path.join(outRoot, "10 Manifest"),
  };
  for (const d of Object.values(dirs)) ensureDir(d);

  // --- 01 Setup ---
  const setupExeName = "Flowtix-ERP-Setup.exe";
  const setupDest = path.join(dirs.setup, setupExeName);
  copyFile(installerSrc, setupDest);
  writeText(
    path.join(dirs.setup, "README.txt"),
    [
      "Flowtix ERP — Setup",
      "",
      `Run ${setupExeName} as Administrator on the Windows LAN server.`,
      "Prerequisites: Windows Server/Desktop, Node.js LTS, MySQL 8+, Administrator rights.",
      "See 02 Documentation\\01_Installation_Guide.md before installing.",
      "",
      "Silent example:",
      `  ${setupExeName} /VERYSILENT /DIR="C:\\FT-ERP" /LOG="C:\\FT-ERP\\logs\\installer-inno.log"`,
      "",
    ].join("\n"),
  );

  // --- 04 Server ---
  const serverZip = path.join(dirs.server, "Flowtix-Server.zip");
  if (!args.skipZip) {
    console.log("[create-customer-media] Zipping server package...");
    zipDirectory(releaseDir, serverZip);
  } else {
    // Copy folder for lab without zip
    copyDir(releaseDir, path.join(dirs.server, releaseName));
  }
  writeText(
    path.join(dirs.server, "README.txt"),
    [
      "Flowtix ERP — Server package",
      "",
      "Flowtix-Server.zip contains the certified release (app, web, prisma, tools).",
      "Prefer the Windows installer in 01 Setup for first-time installs.",
      "Manual Path A/B setup: extract zip, then tools\\setup-flowtix.bat (see Installation Guide).",
      "",
    ].join("\n"),
  );

  // --- 02 Documentation ---
  const custDocs = path.join(ROOT, "docs", "product", "06_Deployment", "customer");
  copyDir(custDocs, dirs.documentation);
  // Cross-ref FT-DEP (copy key owner docs into Documentation/reference)
  const refDir = path.join(dirs.documentation, "reference");
  ensureDir(refDir);
  const handover = path.join(ROOT, "docs", "product", "06_Deployment", "handover");
  for (const f of [
    "FT-DEP-011_Production_Readiness.md",
    "FT-DEP-012_Administrator_Runbook.md",
    "FT-DEP-013_Version_Compatibility_Matrix.md",
    "README.md",
  ]) {
    const src = path.join(handover, f);
    if (fs.existsSync(src)) copyFile(src, path.join(refDir, f));
  }
  const dep001 = path.join(
    ROOT,
    "docs",
    "product",
    "06_Deployment",
    "FT-DEP-001_Deployment_Release_Management.md",
  );
  if (fs.existsSync(dep001)) {
    copyFile(dep001, path.join(refDir, "FT-DEP-001_Deployment_Release_Management.md"));
  }

  // --- 03 Demo ---
  const demoSrc = path.join(DEPLOY, "demo");
  copyDir(demoSrc, dirs.demo);

  // --- 05 Utilities ---
  writeText(
    path.join(dirs.utilities, "README.txt"),
    [
      "Flowtix ERP — Utilities (pointers)",
      "",
      "After installation, utilities live under {FT_ERP_HOME}\\tools\\:",
      "  backup-db.bat, migrate-db.bat, update-flowtix.bat, rollback-flowtix.bat",
      "  verify-install.bat, collect-diagnostics.bat, firewall-flowtix.bat",
      "  service-*.bat, configure-env.bat, install-validate.bat, db-safety.bat",
      "",
      "Demo seed (lab only): see 03 Demo\\seed-demo-environment.js",
      "Never run demo seed against a live customer database.",
      "",
    ].join("\n"),
  );
  // Convenience copies of key verify helpers from release tools
  for (const name of ["verify-install.bat", "verify-install.js", "collect-diagnostics.bat", "collect-diagnostics.js", "install-common.js"]) {
    const src = path.join(releaseDir, "tools", name);
    if (fs.existsSync(src)) copyFile(src, path.join(dirs.utilities, name));
  }

  // --- 06 Support ---
  copyDir(path.join(handover, "templates"), path.join(dirs.support, "templates"));
  writeText(
    path.join(dirs.support, "README.txt"),
    [
      "Flowtix ERP — Support",
      "",
      "1. Read 02 Documentation\\09_Support_Guide.md",
      "2. Collect diagnostics: tools\\collect-diagnostics.bat --home <FT_ERP_HOME>",
      "3. Use templates\\Support_Escalation.md — never paste passwords or full .env",
      "",
      "Support email (placeholder): support@flowtix.example",
      "Website (placeholder): https://www.flowtix.example",
      "Vendor: Chaitanya Computer Solutions",
      "",
    ].join("\n"),
  );

  // --- 07 Release Notes ---
  const rnSrc = path.join(releaseDir, "RELEASE_NOTES.md");
  if (fs.existsSync(rnSrc)) copyFile(rnSrc, path.join(dirs.releaseNotes, "RELEASE_NOTES.md"));
  const custRn = path.join(custDocs, "10_Release_Notes.md");
  if (fs.existsSync(custRn)) copyFile(custRn, path.join(dirs.releaseNotes, "Customer_Release_Notes.md"));
  const hist = path.join(custDocs, "12_Version_History.md");
  if (fs.existsSync(hist)) copyFile(hist, path.join(dirs.releaseNotes, "Version_History.md"));

  // --- 09 License ---
  copyFile(
    path.join(DEPLOY, "installer", "license.txt"),
    path.join(dirs.license, "EULA.txt"),
  );
  writeText(
    path.join(dirs.license, "NOTICE.txt"),
    [
      "Flowtix ERP",
      "Copyright © 2026 Chaitanya Computer Solutions",
      "All rights reserved except as granted in your license agreement.",
      "",
      "Product: Flowtix ERP",
      "Tagline: Enquiry to Dispatch",
      "",
      "Third-party runtimes (Node.js, MySQL, WinSW) remain under their respective licenses.",
      "",
    ].join("\n"),
  );

  // --- Root README ---
  writeText(
    path.join(outRoot, "README.txt"),
    [
      `Flowtix ERP v${version} — Customer Delivery Package`,
      `Build: ${buildDate}`,
      `Git:   ${commit}`,
      "",
      "Folders:",
      "  01 Setup          — Windows installer (start here)",
      "  02 Documentation  — Customer guides + FT-DEP references",
      "  03 Demo           — Demo seed & walkthrough (lab only)",
      "  04 Server         — Certified server ZIP",
      "  05 Utilities      — Verification helpers",
      "  06 Support        — Escalation templates",
      "  07 Release Notes  — What changed",
      "  08 Checksums      — SHA256SUMS.txt",
      "  09 License        — EULA / NOTICE",
      "  10 Manifest       — RELEASE_MANIFEST.json + inventory",
      "",
      "Recommended path: read 02 Documentation\\00_Documentation_Index.md,",
      "then run 01 Setup\\Flowtix-ERP-Setup.exe as Administrator.",
      "",
    ].join("\n"),
  );

  // --- Checksums + Manifest ---
  const hashTargets = [];
  for (const rel of listFilesRecursive(outRoot, outRoot)) {
    if (rel.startsWith("08 Checksums/") || rel.startsWith("10 Manifest/")) continue;
    hashTargets.push(rel);
  }
  const checksumLines = [];
  const fileInventory = [];
  for (const rel of hashTargets) {
    const full = path.join(outRoot, rel);
    const st = fs.statSync(full);
    const digest = sha256File(full);
    checksumLines.push(`${digest}  ${rel}`);
    fileInventory.push({ path: rel, bytes: st.size, sha256: digest });
  }
  writeText(path.join(dirs.checksums, "SHA256SUMS.txt"), checksumLines.join("\n") + "\n");
  writeText(
    path.join(dirs.checksums, "README.txt"),
    [
      "Verify with PowerShell:",
      "  Get-FileHash -Algorithm SHA256 '.\\01 Setup\\Flowtix-ERP-Setup.exe'",
      "Compare to the matching line in SHA256SUMS.txt.",
      "",
    ].join("\n"),
  );

  const mig = migrationHead(releaseDir);
  const releaseVersionTxt = fs.readFileSync(path.join(releaseDir, "VERSION.txt"), "utf8");
  const manifest = {
    productName: "Flowtix ERP",
    productVersion: version,
    installerVersion: version,
    installerFileName: setupExeName,
    serverPackage: args.skipZip ? releaseName : "Flowtix-Server.zip",
    mediaFolder: mediaName,
    buildDate,
    gitCommit: commit,
    prismaMigrationHead: mig,
    packagingMilestone: "FT-DEP-001-Milestone-4",
    releasePackageVersionTxt: releaseVersionTxt.trim().split(/\r?\n/),
    support: {
      emailPlaceholder: "support@flowtix.example",
      websitePlaceholder: "https://www.flowtix.example",
      vendor: "Chaitanya Computer Solutions",
    },
    fileCount: fileInventory.length,
    files: fileInventory,
  };
  writeText(
    path.join(dirs.manifest, "RELEASE_MANIFEST.json"),
    JSON.stringify(manifest, null, 2),
  );
  writeText(
    path.join(dirs.manifest, "FILE_INVENTORY.txt"),
    fileInventory.map((f) => `${f.sha256.slice(0, 12)}…\t${f.bytes}\t${f.path}`).join("\n") + "\n",
  );

  // Self-hash manifest after write (append note only — avoid circular hash of checksums)
  writeText(
    path.join(dirs.manifest, "BUILD_INFO.txt"),
    [
      `productVersion=${version}`,
      `installerVersion=${version}`,
      `buildDate=${buildDate}`,
      `gitCommit=${commit}`,
      `prismaMigrationHead=${mig}`,
      `mediaRoot=${outRoot}`,
      "",
    ].join("\n"),
  );

  console.log("");
  console.log("[create-customer-media] SUCCESS");
  console.log(`  Media: ${outRoot}`);
  console.log(`  Setup: ${setupDest}`);
  console.log(`  Files hashed: ${fileInventory.length}`);
  console.log(`  Migration head: ${mig}`);
  process.exit(0);
}

main();
