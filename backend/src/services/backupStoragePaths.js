/**
 * Re-export single shared backup path resolver (SSOT: deployment/lib/backupStoragePaths.js).
 * Bundled into app via static relative require; tools get a create-release copy of the same file.
 */
module.exports = require("../../../deployment/lib/backupStoragePaths");
