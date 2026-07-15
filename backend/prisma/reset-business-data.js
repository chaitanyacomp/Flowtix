/**
 * LEGACY — do not use for full transaction wipe.
 *
 * Prefer the canonical Reset Transaction Data path:
 *   node scripts/resetTransactions.js
 *   or Settings → Database Cleanup → Reset Transaction Data
 *
 * This script is incomplete vs current schema (missing recovery / RS / Phase 2B
 * models) and can fail with FK errors. It is retained only for historical
 * npm script compatibility and exits with guidance.
 *
 * Usage (from backend/):  npm run db:reset-business
 */
/* eslint-disable no-console */
console.error(
  "[reset-business] DEPRECATED.\n" +
    "Use the canonical cleanup registry path instead:\n" +
    "  node scripts/resetTransactions.js\n" +
    "  or POST /api/admin/database-cleanup/reset-transaction-data\n" +
    "Verify dependencies with: npm run verify:cleanup-dependencies\n",
);
process.exit(1);
