/**
 * FT-DEP-001 Batch 1 — write VERSION.txt and RELEASE_NOTES.md for a release folder.
 * Invoked by create-release.bat (no business logic).
 *
 * Env:
 *   OUT_DIR, PRODUCT_VERSION, RELEASE_NAME, BUILD_DATE, GIT_COMMIT
 *   ROOT (optional) — repo root for migration discovery
 *   MIGRATION_HEAD (optional) — override
 */
const fs = require("fs");
const path = require("path");

const out = process.env.OUT_DIR;
const root = process.env.ROOT || process.cwd();
const v = process.env.PRODUCT_VERSION || "0.0.0";
const name = process.env.RELEASE_NAME || `Flowtix-v${v}`;
const built = process.env.BUILD_DATE || new Date().toISOString();
const commit = process.env.GIT_COMMIT || "unknown";

function resolveMigrationHead() {
  if (process.env.MIGRATION_HEAD && process.env.MIGRATION_HEAD !== "unknown") {
    return process.env.MIGRATION_HEAD;
  }
  const candidates = [
    path.join(out, "prisma", "migrations"),
    path.join(root, "backend", "prisma", "migrations"),
  ];
  for (const d of candidates) {
    if (!fs.existsSync(d)) continue;
    const names = fs
      .readdirSync(d, { withFileTypes: true })
      .filter((x) => x.isDirectory() && !x.name.startsWith("."))
      .map((x) => x.name)
      .sort();
    if (names.length) return names[names.length - 1];
  }
  return "none";
}

const mig = resolveMigrationHead();

if (!out) {
  console.error("OUT_DIR is required");
  process.exit(1);
}

fs.mkdirSync(out, { recursive: true });

const versionTxt = [
  "productName=Flowtix ERP",
  `productVersion=${v}`,
  `releaseFolder=${name}`,
  `buildDate=${built}`,
  `gitCommit=${commit}`,
  `prismaMigrationHead=${mig}`,
  "packagingBatch=FT-DEP-001-Milestone-4",
  "",
].join("\n");

const notes = `# Flowtix ERP - Release Notes

## Version

\`${v}\` (${name})

## Build Date

\`${built}\`

## Git Commit

\`${commit}\`

## Database Migration

Latest migration included in this package:

\`${mig}\`

Apply on the client server with Prisma migrate deploy against shared/.env DATABASE_URL
(see FT-DEP-001 section 11 - migrate helper tooling is a later batch).

## Breaking Changes

- _None recorded for this build. Edit before customer delivery if applicable._

## Fixed (installer)

- **Place-release self-wipe (FT-DEP-001 v1.14):** When Batch 9 runs with \`--source\` equal to \`{home}\\releases\\Flowtix-vX\` (Inno post-install layout), setup no longer refreshes the archive onto itself. Live \`app/\` and \`web/\` are promoted correctly. Verify after install: \`{home}/app/server.js\` and \`{home}/web/index.html\` exist; \`certify-install\` case \`place_release_installer_layout\`.
- **Post-install invocation (FT-DEP-001 v1.14.1):** Inno \`[Run]\` calls \`post-install.bat\` directly (not \`cmd /C "bat" "args"\`, which dropped arguments). \`existing_install\` allows \`shared/.env\`-only first bootstrap; Administrator is a hard fail only when service/firewall install is requested.

## Known Issues

- Inno Setup may report the product as installed even if \`post-install\` / \`setup-flowtix\` exits non-zero. Always confirm live runtime + \`logs/installer-post.log\` \`SETUP_EXIT=0\` (FT-DEP-001 §35.4.1).

## Package Contents (Batch 1+3+4+5+6+7+8+9+10+11)

- \`web/\` - Vite production frontend
- \`app/server.js\` - esbuild-bundled Node/Express entry (Batch 3)
- \`app/package.json\` - production runtime dependencies only
- \`app/prisma/generated/\` - Prisma Client for this build
- \`prisma/\` - schema.prisma + migrations
- \`shared/\` - env template only
- \`tools/backup-db.*\` - safe mysqldump backup (Batch 4)
- \`tools/migrate-db.*\` - prisma migrate deploy with backup gate (Batch 5)
- \`tools/update-flowtix.*\` - one-click update orchestrator (Batch 6)
- \`tools/rollback-flowtix.*\` - app/web rollback from pre-update archive (Batch 7)
- \`tools/service-*.bat\` + \`service-control.js\` - optional WinSW Windows Service (Batch 8)
- \`tools/setup-flowtix.*\` / \`check-prereqs.*\` / \`init-folders.*\` - client setup bootstrap (Batch 9)
- \`tools/verify-install.*\` - read-only install verification (Batch 11)
- \`docs/handover/\` - production readiness, checklists, runbook, templates (Batch 11)

## Windows Installer (Batch 10)

Build separately: \`deployment/installer/build-installer.bat\` → \`Flowtix-Setup-vX.Y.Z.exe\` (Inno Setup wrapper; not embedded in this folder).

## Not Included (later batches)

- Automated DB restore
- MSI / WiX installer
- Docker / pkg / nexe packaging
- Raw \`app/src/\` application tree (replaced by bundle)
`;

fs.writeFileSync(path.join(out, "VERSION.txt"), versionTxt, "utf8");
fs.writeFileSync(path.join(out, "RELEASE_NOTES.md"), notes, "utf8");
console.log(`[write-release-meta] Wrote VERSION.txt and RELEASE_NOTES.md (migration=${mig})`);
