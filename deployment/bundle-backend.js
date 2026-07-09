/**
 * FT-DEP-001 Batch 3 — esbuild backend bundle.
 *
 * Bundles backend/src/server.js → release/.../app/server.js
 * Externalizes native / Prisma / node_modules packages so engines stay compatible.
 *
 * Usage:
 *   node deployment/bundle-backend.js [--out <dir>] [--version <x.y.z>]
 *
 * Env:
 *   RELEASE_DIR / PRODUCT_VERSION — optional overrides (set by build-backend.bat)
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BACKEND = path.join(ROOT, "backend");
const ENTRY = path.join(BACKEND, "src", "server.js");

/**
 * Ensure deployment/node_modules/esbuild resolves @esbuild/win32-x64 (npm layout).
 * Prefer checked-in vendor/ when npm cannot materialize esbuild on this machine.
 */
function ensureDeploymentEsbuildLayout() {
  const nm = path.join(__dirname, "node_modules");
  const esbDir = path.join(nm, "esbuild");
  const platDir = path.join(nm, "@esbuild", "win32-x64");
  const vendorEsb = path.join(__dirname, "vendor", "esbuild");
  const vendorPlat = path.join(__dirname, "vendor", "@esbuild", "win32-x64");

  if (fs.existsSync(path.join(esbDir, "lib", "main.js")) && fs.existsSync(path.join(platDir, "esbuild.exe"))) {
    return esbDir;
  }
  if (!fs.existsSync(vendorEsb) || !fs.existsSync(vendorPlat)) {
    return null;
  }
  fs.mkdirSync(path.join(nm, "@esbuild"), { recursive: true });
  fs.cpSync(vendorEsb, esbDir, { recursive: true });
  fs.cpSync(vendorPlat, platDir, { recursive: true });
  return esbDir;
}

/**
 * Resolve esbuild:
 * 1) deployment/node_modules/esbuild (synced from vendor if needed)
 * 2) backend/node_modules/esbuild
 * 3) bare require("esbuild")
 */
function loadEsbuild() {
  const local = ensureDeploymentEsbuildLayout();
  const candidates = [
    local,
    path.join(BACKEND, "node_modules", "esbuild"),
    path.join(ROOT, "node_modules", "esbuild"),
    "esbuild",
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      return require(c);
    } catch {
      // try next
    }
  }
  throw new Error(
    "esbuild not found. Restore deployment/vendor/esbuild or run: npm install --save-dev esbuild --prefix backend",
  );
}

const esbuild = loadEsbuild();

function readProductVersion() {
  if (process.env.PRODUCT_VERSION && String(process.env.PRODUCT_VERSION).trim()) {
    return String(process.env.PRODUCT_VERSION).trim();
  }
  const pkg = require(path.join(BACKEND, "package.json"));
  return pkg.version || "1.0.0";
}

function parseArgs(argv) {
  const out = { outDir: null, version: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--out" && argv[i + 1]) {
      out.outDir = path.resolve(argv[++i]);
    } else if (argv[i] === "--version" && argv[i + 1]) {
      out.version = String(argv[++i]);
    }
  }
  return out;
}

function resolveOutDir(args) {
  if (args.outDir) return args.outDir;
  if (process.env.RELEASE_DIR && String(process.env.RELEASE_DIR).trim()) {
    return path.join(path.resolve(String(process.env.RELEASE_DIR).trim()), "app");
  }
  const version = args.version || readProductVersion();
  return path.join(ROOT, "release", `Flowtix-v${version}`, "app");
}

/**
 * Production package.json for the release app/ folder.
 * Drops file: mini-erp (repo self-link), keeps runtime deps only.
 */
function writeProductionPackageJson(appDir) {
  const src = require(path.join(BACKEND, "package.json"));
  const deps = { ...(src.dependencies || {}) };
  delete deps["mini-erp"];

  const out = {
    name: "flowtix-erp-app",
    version: src.version || "1.0.0",
    private: true,
    main: "server.js",
    scripts: {
      start: "node server.js",
      "prisma:generate": "prisma generate --schema=../prisma/schema.prisma",
      "prisma:deploy": "prisma migrate deploy --schema=../prisma/schema.prisma",
    },
    dependencies: deps,
    // prisma CLI needed on server for migrate deploy / generate (not bundled).
    // Keep as optional install note — operators run from release with prisma in PATH
    // or install prisma as a one-off. We list it under optionalDependencies guidance
    // via README; do not pull nodemon/supertest.
  };

  fs.writeFileSync(path.join(appDir, "package.json"), JSON.stringify(out, null, 2) + "\n", "utf8");
}

function copyPrismaGeneratedClient(appDir) {
  const srcClient = path.join(BACKEND, "prisma", "generated", "client-v2");
  const destClient = path.join(appDir, "prisma", "generated", "client-v2");
  if (!fs.existsSync(srcClient)) {
    throw new Error(
      `Prisma generated client missing at ${srcClient}. Run: npm run prisma:generate --prefix backend`,
    );
  }
  fs.mkdirSync(path.dirname(destClient), { recursive: true });
  fs.cpSync(srcClient, destClient, { recursive: true });
}

async function bundle() {
  const args = parseArgs(process.argv);
  const appDir = resolveOutDir(args);
  const outfile = path.join(appDir, "server.js");

  if (!fs.existsSync(ENTRY)) {
    throw new Error(`Entry not found: ${ENTRY}`);
  }

  fs.mkdirSync(appDir, { recursive: true });

  // Remove previous src/ tree if present (Batch 1 leftover) — Batch 3 ships bundle only.
  const legacySrc = path.join(appDir, "src");
  if (fs.existsSync(legacySrc)) {
    fs.rmSync(legacySrc, { recursive: true, force: true });
  }

  console.log(`[bundle-backend] entry: ${ENTRY}`);
  console.log(`[bundle-backend] out:   ${outfile}`);

  const result = await esbuild.build({
    entryPoints: [ENTRY],
    outfile,
    bundle: true,
    platform: "node",
    target: ["node18"],
    format: "cjs",
    // Keep node_modules external (Prisma engines, native addons, express tree).
    packages: "external",
    // Explicit externals for clarity / custom prisma path.
    external: [
      "@prisma/client",
      ".prisma/*",
      "prisma",
      "bcryptjs",
      "cors",
      "dotenv",
      "express",
      "fast-xml-parser",
      "jsonwebtoken",
      "multer",
      "mysql2",
      "pdfkit",
      "zod",
      "mini-erp",
    ],
    sourcemap: false,
    minify: false,
    logLevel: "info",
    // Banner documents Batch 3 packaging; does not change behavior.
    banner: {
      js: "/* Flowtix ERP — FT-DEP-001 Batch 3 esbuild bundle. Do not edit. */\n",
    },
  });

  if (result.errors?.length) {
    throw new Error(`esbuild failed: ${JSON.stringify(result.errors)}`);
  }

  writeProductionPackageJson(appDir);
  copyPrismaGeneratedClient(appDir);

  // Env template only — never .env secrets.
  const envExample = path.join(BACKEND, ".env.example");
  if (fs.existsSync(envExample)) {
    fs.copyFileSync(envExample, path.join(appDir, ".env.example"));
  }

  fs.writeFileSync(
    path.join(appDir, "README.txt"),
    [
      "Flowtix ERP — backend runtime package (FT-DEP-001 Batch 3 / esbuild)",
      "",
      "Contents:",
      "  server.js                 — bundled application entry",
      "  package.json              — production runtime dependencies",
      "  prisma/generated/client-v2 — Prisma Client for this build",
      "",
      "Sibling folders (release root):",
      "  ../prisma/schema.prisma + migrations/",
      "  ../shared/.env",
      "  ../web/",
      "",
      "Install & start (on client server):",
      "  npm install --omit=dev",
      "  npm start",
      "",
      "Prisma migrate (from release root, after shared/.env is set):",
      "  npx prisma migrate deploy --schema=prisma/schema.prisma",
      "  npx prisma generate --schema=prisma/schema.prisma",
      "  (then re-copy or regenerate client into app/prisma/generated if needed)",
      "",
      "Excluded: src/, test/, scripts/, docs/, .git/, .env, source maps",
      "",
      "IP note: JavaScript bundling is deterrence, not DRM (see FT-DEP-001 §15 / §28).",
      "",
    ].join("\n"),
    "utf8",
  );

  if (!fs.existsSync(outfile)) {
    throw new Error("Bundle output missing after esbuild");
  }
  if (fs.existsSync(path.join(appDir, "src"))) {
    throw new Error("app/src must not exist after Batch 3 bundling");
  }

  console.log("[bundle-backend] Done.");
  return { appDir, outfile };
}

bundle().catch((err) => {
  console.error("[bundle-backend] ERROR:", err instanceof Error ? err.message : err);
  process.exit(1);
});
