/**
 * Single import path for the generated Prisma client + enums.
 * Custom output: prisma/schema.prisma → output = "./generated/client-v2"
 *
 * Resolves via getPackageRoot() so Batch 3 esbuild bundles keep a dynamic require
 * (esbuild cannot statically inline the engine; client stays on disk under app/prisma/).
 */
const path = require("path");
const fs = require("fs");
const { getPackageRoot } = require("./runtime/paths");

function resolvePrismaClientDir() {
  const root = getPackageRoot();
  const candidates = [
    path.join(root, "prisma", "generated", "client-v2"),
    // Source tree fallback when getPackageRoot is backend/
    path.join(root, "prisma", "generated", "client"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  throw new Error(
    "Prisma client not found under " +
      root +
      "/prisma/generated/client-v2. Run `npm run prisma:generate --prefix backend` " +
      "or ensure the release package includes the generated client.",
  );
}

module.exports = require(resolvePrismaClientDir());
