/**
 * FT-DEP-001 Milestone 2 — production static hosting for packaged web/ SPA.
 *
 * Serves release `web/` (Vite dist) from Express. API routes and /health remain
 * registered before this middleware and are never overridden by SPA fallback.
 *
 * Development: disabled by default (Vite owns the UI on :5173).
 */
const fs = require("fs");
const path = require("path");
const express = require("express");
const { resolveRuntimePaths } = require("./paths");

/** Markers expected in packaged index.html (login shell; no auth required). */
const FRONTEND_MARKERS = ["Flowtix ERP", "ft-erp-splash", "root"];

/**
 * Resolve packaged web/ directory from runtime paths / overrides.
 * @param {object} [options]
 * @param {string} [options.webDir]
 * @param {ReturnType<typeof resolveRuntimePaths>} [options.paths]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {string|null}
 */
function resolveWebDir(options = {}) {
  if (options.webDir && String(options.webDir).trim()) {
    return path.resolve(String(options.webDir).trim());
  }
  const env = options.env || process.env;
  if (env.WEB_DIR && String(env.WEB_DIR).trim()) {
    return path.resolve(String(env.WEB_DIR).trim());
  }

  const runtime = options.paths || resolveRuntimePaths(env);
  const candidates = [
    path.join(runtime.homeDir, "web"),
    path.join(runtime.homeDir, "current", "web"),
  ];
  if (runtime.releaseDir) {
    candidates.push(path.join(runtime.releaseDir, "web"));
  }
  if (runtime.packageRoot) {
    candidates.push(path.resolve(runtime.packageRoot, "..", "web"));
  }

  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "index.html"))) {
      return c;
    }
  }
  return null;
}

/**
 * @param {object} [options]
 * @param {boolean} [options.staticHosting] — force on/off
 * @param {string} [options.webDir]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {{ enabled: boolean, webDir: string|null, reason: string }}
 */
function resolveStaticHostingOptions(options = {}) {
  const env = options.env || process.env;

  if (options.staticHosting === false) {
    return { enabled: false, webDir: null, reason: "disabled by options.staticHosting=false" };
  }

  const forceOn =
    options.staticHosting === true ||
    Boolean(options.webDir) ||
    String(env.FT_SERVE_WEB || "").trim() === "1";

  const isProduction = String(env.NODE_ENV || "").toLowerCase() === "production";

  if (!forceOn && !isProduction) {
    return {
      enabled: false,
      webDir: null,
      reason: "development mode (Vite serves UI); set FT_SERVE_WEB=1 to force",
    };
  }

  const webDir = resolveWebDir({ ...options, env });
  if (!webDir || !fs.existsSync(path.join(webDir, "index.html"))) {
    return {
      enabled: false,
      webDir: null,
      reason: "web/ with index.html not found",
    };
  }

  return { enabled: true, webDir, reason: "ok" };
}

/**
 * Whether SPA fallback should serve index.html for this request path.
 * Never for /api/* (API isolation). Health is registered earlier so rarely reaches here.
 * @param {string} urlPath
 */
function shouldSpaFallback(urlPath) {
  if (!urlPath || typeof urlPath !== "string") return false;
  const p = urlPath.split("?")[0];
  if (p === "/api" || p.startsWith("/api/")) return false;
  if (p === "/health") return false;
  // Avoid treating dotted asset paths that miss on disk as SPA (express.static already tried).
  const base = path.posix.basename(p);
  if (base.includes(".") && !p.endsWith(".html")) return false;
  return true;
}

/**
 * Register static file + SPA fallback middleware on an Express app.
 * Call AFTER all /api and /health routes, BEFORE the error handler.
 *
 * @param {import('express').Express} app
 * @param {{ webDir: string, log?: (msg: string) => void }} options
 */
function registerStaticHosting(app, options) {
  const webDir = path.resolve(options.webDir);
  const indexHtml = path.join(webDir, "index.html");
  const log = typeof options.log === "function" ? options.log : () => {};

  if (!fs.existsSync(indexHtml)) {
    log(`[static] web/index.html missing at ${webDir} — SPA not mounted`);
    return { mounted: false, webDir };
  }

  app.use(
    express.static(webDir, {
      index: false,
      fallthrough: true,
      maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
    }),
  );

  // Express 5-safe SPA fallback (no wildcard route syntax).
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (!shouldSpaFallback(req.path)) return next();
    return res.sendFile(indexHtml, (err) => {
      if (err) next(err);
    });
  });

  log(`[static] Serving SPA from ${webDir}`);
  return { mounted: true, webDir };
}

module.exports = {
  FRONTEND_MARKERS,
  resolveWebDir,
  resolveStaticHostingOptions,
  shouldSpaFallback,
  registerStaticHosting,
};
