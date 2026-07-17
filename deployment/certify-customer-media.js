/**
 * FT-DEP-001 Milestone 4 — certify customer delivery media.
 *
 * Usage:
 *   node deployment/certify-customer-media.js [--media <path>]
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const out = { media: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--media" && argv[i + 1]) out.media = path.resolve(argv[++i]);
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

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function mustExist(results, id, p) {
  const ok = fs.existsSync(p);
  results.push({ id, ok, detail: ok ? p : `missing: ${p}` });
  return ok;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const version = productVersion();
  const media =
    args.media || path.join(ROOT, "customer-media", `Flowtix-ERP-v${version}`);
  const results = [];

  mustExist(results, "media_root", media);
  mustExist(results, "setup_exe", path.join(media, "01 Setup", "Flowtix-ERP-Setup.exe"));
  mustExist(results, "server_zip", path.join(media, "04 Server", "Flowtix-Server.zip"));
  mustExist(results, "doc_index", path.join(media, "02 Documentation", "00_Documentation_Index.md"));
  mustExist(results, "install_guide", path.join(media, "02 Documentation", "01_Installation_Guide.md"));
  mustExist(results, "acceptance_cert", path.join(media, "02 Documentation", "acceptance", "09_Final_Acceptance_Certificate.md"));
  mustExist(results, "demo_readme", path.join(media, "03 Demo", "README.md"));
  mustExist(results, "demo_seed", path.join(media, "03 Demo", "seed-demo-environment.js"));
  mustExist(results, "demo_users", path.join(media, "03 Demo", "DEMO_USERS.md"));
  mustExist(results, "sha256", path.join(media, "08 Checksums", "SHA256SUMS.txt"));
  mustExist(results, "manifest", path.join(media, "10 Manifest", "RELEASE_MANIFEST.json"));
  mustExist(results, "eula", path.join(media, "09 License", "EULA.txt"));
  mustExist(results, "readme", path.join(media, "README.txt"));

  // Placeholder scan (customer docs)
  const docsDir = path.join(media, "02 Documentation");
  let placeholderHits = 0;
  if (fs.existsSync(docsDir)) {
    const walk = (d) => {
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, ent.name);
        if (ent.isDirectory()) walk(full);
        else if (/\.(md|txt)$/i.test(ent.name)) {
          const t = fs.readFileSync(full, "utf8");
          if (/TODO:|TBD|FIXME|lorem ipsum/i.test(t)) {
            placeholderHits += 1;
            results.push({ id: `placeholder:${ent.name}`, ok: false, detail: full });
          }
        }
      }
    };
    walk(docsDir);
  }
  if (placeholderHits === 0) {
    results.push({ id: "no_placeholder_docs", ok: true, detail: "no TODO/TBD/FIXME in customer docs" });
  }

  // Checksum verify setup exe
  const sumsPath = path.join(media, "08 Checksums", "SHA256SUMS.txt");
  const setupPath = path.join(media, "01 Setup", "Flowtix-ERP-Setup.exe");
  if (fs.existsSync(sumsPath) && fs.existsSync(setupPath)) {
    const lines = fs.readFileSync(sumsPath, "utf8").split(/\r?\n/);
    const setupRel = "01 Setup/Flowtix-ERP-Setup.exe";
    const line = lines.find((l) => l.includes(setupRel));
    const actual = sha256File(setupPath);
    const expected = line ? line.trim().split(/\s+/)[0] : null;
    const ok = expected && expected === actual;
    results.push({
      id: "checksum_setup_exe",
      ok: !!ok,
      detail: ok ? `sha256 match ${actual.slice(0, 12)}…` : `mismatch expected=${expected} actual=${actual}`,
    });
  }

  // Manifest consistency
  const manPath = path.join(media, "10 Manifest", "RELEASE_MANIFEST.json");
  if (fs.existsSync(manPath)) {
    const man = JSON.parse(fs.readFileSync(manPath, "utf8"));
    const ok =
      man.productVersion === version &&
      man.installerVersion === version &&
      man.productName === "Flowtix ERP";
    results.push({
      id: "manifest_version",
      ok,
      detail: ok
        ? `productVersion=${man.productVersion} migration=${man.prismaMigrationHead}`
        : JSON.stringify({ productVersion: man.productVersion, expected: version }),
    });
  }

  // Branding source checks (repo)
  const branding = fs.readFileSync(
    path.join(ROOT, "frontend", "src", "components", "branding", "Branding.tsx"),
    "utf8",
  );
  results.push({
    id: "brand_product_name",
    ok: /BRAND_PRODUCT_NAME = "Flowtix ERP"/.test(branding),
    detail: "Flowtix ERP product constant",
  });
  results.push({
    id: "brand_support_placeholder",
    ok: /support@flowtix\.example/.test(branding),
    detail: "support email placeholder present",
  });
  const iss = fs.readFileSync(path.join(ROOT, "deployment", "installer", "Flowtix.iss"), "utf8");
  results.push({
    id: "installer_publisher",
    ok: /Chaitanya Computer Solutions/.test(iss),
    detail: "Inno AppPublisher aligned to vendor",
  });

  const failed = results.filter((r) => !r.ok);
  console.log("[certify-customer-media] Milestone 4");
  console.log(`  media=${media}`);
  for (const r of results) {
    console.log(`  [${r.ok ? "PASS" : "FAIL"}] ${r.id}: ${r.detail}`);
  }
  console.log(
    failed.length
      ? `[certify-customer-media] FAILED (${failed.length})`
      : `[certify-customer-media] PASSED (${results.length})`,
  );
  process.exit(failed.length ? 2 : 0);
}

main();
