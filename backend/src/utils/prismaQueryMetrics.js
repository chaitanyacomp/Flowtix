const { AsyncLocalStorage } = require("async_hooks");

const queryMetricsStore = new AsyncLocalStorage();

/**
 * Run `fn` with a per-request Prisma query counter and request-local cache.
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
function runWithQueryMetrics(fn) {
  return queryMetricsStore.run({ queryCount: 0, requestCache: new Map(), querySignatures: new Map() }, fn);
}

function incrementPrismaQueryCount(params) {
  const store = queryMetricsStore.getStore();
  if (store) {
    store.queryCount += 1;
    if (params?.model && params?.action) {
      const sig = `${params.model}.${params.action}`;
      store.querySignatures.set(sig, (store.querySignatures.get(sig) ?? 0) + 1);
    }
  }
}

function getPrismaQueryCount() {
  const store = queryMetricsStore.getStore();
  return store ? store.queryCount : null;
}

/** Top duplicate Prisma model.action patterns within the current request. */
function getPrismaQueryDuplicatePatterns(limit = 5) {
  const store = queryMetricsStore.getStore();
  if (!store?.querySignatures?.size) return [];
  return [...store.querySignatures.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([pattern, count]) => ({ pattern, count }));
}

/**
 * Request-local memo — dedupes concurrent async work within one HTTP request.
 * @template T
 * @param {string} key
 * @param {() => T | Promise<T>} factory
 * @returns {Promise<T>}
 */
function getOrSetRequestCache(key, factory) {
  const store = queryMetricsStore.getStore();
  if (!store?.requestCache) return Promise.resolve().then(factory);
  if (store.requestCache.has(key)) return store.requestCache.get(key);
  const pending = Promise.resolve()
    .then(factory)
    .catch((err) => {
      store.requestCache.delete(key);
      throw err;
    });
  store.requestCache.set(key, pending);
  return pending;
}

module.exports = {
  runWithQueryMetrics,
  incrementPrismaQueryCount,
  getPrismaQueryCount,
  getPrismaQueryDuplicatePatterns,
  getOrSetRequestCache,
};
