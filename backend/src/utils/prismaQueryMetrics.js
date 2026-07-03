const { AsyncLocalStorage } = require("async_hooks");

const queryMetricsStore = new AsyncLocalStorage();

/**
 * Run `fn` with a per-request Prisma query counter (see utils/prisma.js middleware).
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
function runWithQueryMetrics(fn) {
  return queryMetricsStore.run({ queryCount: 0 }, fn);
}

function incrementPrismaQueryCount() {
  const store = queryMetricsStore.getStore();
  if (store) store.queryCount += 1;
}

function getPrismaQueryCount() {
  const store = queryMetricsStore.getStore();
  return store ? store.queryCount : null;
}

module.exports = {
  runWithQueryMetrics,
  incrementPrismaQueryCount,
  getPrismaQueryCount,
};
