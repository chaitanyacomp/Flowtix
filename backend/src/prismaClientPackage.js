/**
 * Single import path for the generated Prisma client + enums (`prisma/schema.prisma` → `output = "./generated/client"`).
 * Avoids stale `node_modules/.prisma` when `prisma generate` cannot overwrite the Windows query engine DLL.
 */
module.exports = require("../prisma/generated/client");
