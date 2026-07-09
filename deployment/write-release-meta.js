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
  "packagingBatch=FT-DEP-001-Batch-4",
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

## Known Issues

- _None recorded for this build. Edit before customer delivery if applicable._

## Package Contents (Batch 1+3+4+5+6)

- \`web/\` - Vite production frontend
- \`app/server.js\` - esbuild-bundled Node/Express entry (Batch 3)
- \`app/package.json\` - production runtime dependencies only
- \`app/prisma/generated/\` - Prisma Client for this build
- \`prisma/\` - schema.prisma + migrations
- \`shared/\` - env template only
- \`tools/backup-db.*\` - safe mysqldump backup (Batch 4)
- \`tools/migrate-db.*\` - prisma migrate deploy with backup gate (Batch 5)
- \`tools/update-flowtix.*\` - one-click update orchestrator (Batch 6)

## Not Included (later batches)

- Restore / rollback automation
- Windows Service / installer
- Docker / pkg / nexe packaging
- Raw \`app/src/\` application tree (replaced by bundle)
`;

fs.writeFileSync(path.join(out, "VERSION.txt"), versionTxt, "utf8");
fs.writeFileSync(path.join(out, "RELEASE_NOTES.md"), notes, "utf8");
console.log(`[write-release-meta] Wrote VERSION.txt and RELEASE_NOTES.md (migration=${mig})`);
