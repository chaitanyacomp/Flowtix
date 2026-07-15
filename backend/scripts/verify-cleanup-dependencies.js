#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * CI / developer diagnostic: verify cleanup registry vs Prisma schema FKs.
 *
 * Usage:
 *   npm run verify:cleanup-dependencies
 *   node scripts/verify-cleanup-dependencies.js
 */

const {
  validateCleanupRegistryAgainstSchema,
  describeCarryForwardPendingDependencyGraph,
} = require("../src/services/cleanup/cleanupDependencyValidator");
const {
  getTransactionalRegistryEntries,
  getRecoveryClusterClientKeys,
  PRESERVED_MASTER_MODELS,
} = require("../src/services/cleanup/cleanupRegistry");

function main() {
  const result = validateCleanupRegistryAgainstSchema();
  const registered = getTransactionalRegistryEntries();

  console.log("=== Cleanup dependency verification ===\n");
  console.log(`Registered transactional models: ${registered.length}`);
  for (const e of registered) {
    console.log(`  [${String(e.phase).padStart(3)}] ${e.prismaModel} (${e.clientKey})`);
  }

  console.log("\nPreserved master models:");
  for (const m of PRESERVED_MASTER_MODELS) {
    console.log(`  - ${m}`);
  }

  console.log("\nRecovery cluster (delete before CarryForwardPending):");
  for (const key of getRecoveryClusterClientKeys()) {
    console.log(`  - ${key}`);
  }

  console.log("\nCarryForwardPending Restrict children (from schema):");
  for (const row of describeCarryForwardPendingDependencyGraph()) {
    const mark = row.registered ? "OK" : "MISSING";
    console.log(`  [${mark}] ${row.child}.${row.field} → CFP (phase=${row.registryPhase ?? "—"})`);
  }

  console.log(`\nDetected blocking transactional deps: ${result.detectedBlockingDeps.length}`);
  if (result.missingModels.length) {
    console.log(`\nMissing models (${result.missingModels.length}):`);
    for (const i of result.missingModels) console.log(`\n${i.message}`);
  }
  if (result.invalidOrder.length) {
    console.log(`\nInvalid delete order (${result.invalidOrder.length}):`);
    for (const i of result.invalidOrder) console.log(`\n${i.message}`);
  }
  if (result.unknownRegistryModels.length) {
    console.log(`\nUnknown registry models (${result.unknownRegistryModels.length}):`);
    for (const i of result.unknownRegistryModels) console.log(`\n${i.message}`);
  }

  if (!result.ok) {
    console.error("\nFAILED: update backend/src/services/cleanup/cleanupRegistry.js");
    process.exitCode = 1;
    return;
  }

  console.log("\nPASSED: cleanup registry matches schema Restrict dependencies.");
}

main();
