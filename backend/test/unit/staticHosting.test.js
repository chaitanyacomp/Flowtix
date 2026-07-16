/**
 * FT-DEP-001 Milestone 2 — static hosting / SPA fallback (no DB).
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const request = require("supertest");
const {
  shouldSpaFallback,
  resolveStaticHostingOptions,
  resolveWebDir,
  FRONTEND_MARKERS,
} = require("../../src/runtime/staticHosting");
const { createApp } = require("../../src/createApp");

function writeMiniWeb(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!doctype html><html><head><title>Flowtix ERP</title></head>` +
      `<body><div id="ft-erp-splash"></div><div id="root"></div></body></html>`,
    "utf8",
  );
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "assets", "app.css"), "body{color:#111}", "utf8");
}

describe("shouldSpaFallback", () => {
  it("allows frontend routes", () => {
    assert.equal(shouldSpaFallback("/dashboard"), true);
    assert.equal(shouldSpaFallback("/sales-orders"), true);
    assert.equal(shouldSpaFallback("/reports"), true);
    assert.equal(shouldSpaFallback("/production"), true);
    assert.equal(shouldSpaFallback("/"), true);
  });

  it("rejects API and health paths", () => {
    assert.equal(shouldSpaFallback("/api"), false);
    assert.equal(shouldSpaFallback("/api/health"), false);
    assert.equal(shouldSpaFallback("/api/sales-orders"), false);
    assert.equal(shouldSpaFallback("/health"), false);
  });

  it("rejects missing static asset-like paths", () => {
    assert.equal(shouldSpaFallback("/assets/missing.js"), false);
  });
});

describe("resolveStaticHostingOptions", () => {
  it("stays off in development by default", () => {
    const r = resolveStaticHostingOptions({ env: { NODE_ENV: "development" } });
    assert.equal(r.enabled, false);
  });

  it("enables when webDir forced even outside production", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ft-web-"));
    writeMiniWeb(root);
    const r = resolveStaticHostingOptions({
      webDir: root,
      env: { NODE_ENV: "development" },
    });
    assert.equal(r.enabled, true);
    assert.equal(r.webDir, path.resolve(root));
  });

  it("disables when web missing in production", () => {
    const r = resolveStaticHostingOptions({
      webDir: path.join(os.tmpdir(), "ft-missing-web-dir-xyz"),
      env: { NODE_ENV: "production" },
    });
    // force via webDir option still looks up index — resolveWebDir returns the path
    // but resolveStaticHostingOptions only checks resolveWebDir existence of index
    assert.equal(r.enabled, false);
    assert.match(r.reason, /not found/i);
  });
});

describe("createApp static hosting", () => {
  let webDir;
  let app;

  before(() => {
    webDir = fs.mkdtempSync(path.join(os.tmpdir(), "ft-spa-"));
    writeMiniWeb(webDir);
    app = createApp({
      staticHosting: true,
      webDir,
      getReleaseMeta: () => ({ productVersion: "1.0.0-test" }),
    });
  });

  after(() => {
    try {
      fs.rmSync(webDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("serves index.html at /", async () => {
    const res = await request(app).get("/").expect(200);
    assert.match(String(res.headers["content-type"] || ""), /html/i);
    assert.match(res.text, /Flowtix ERP/);
    assert.match(res.text, /ft-erp-splash/);
  });

  it("serves static assets", async () => {
    const res = await request(app).get("/assets/app.css").expect(200);
    assert.match(res.text, /color:#111/);
  });

  it("SPA fallback for frontend routes", async () => {
    for (const p of ["/dashboard", "/sales-orders", "/reports", "/production"]) {
      const res = await request(app).get(p).expect(200);
      assert.match(String(res.headers["content-type"] || ""), /html/i);
      assert.match(res.text, /Flowtix ERP/);
    }
  });

  it("keeps /api/health/live JSON (API isolation)", async () => {
    const res = await request(app).get("/api/health/live").expect(200);
    assert.equal(res.body.ok, true);
    assert.equal(res.headers["content-type"]?.includes("json"), true);
  });

  it("does not SPA-fallback unknown /api routes to index.html", async () => {
    const res = await request(app).get("/api/this-route-does-not-exist-xyz");
    assert.notEqual(res.status, 200);
    const body = res.text || "";
    assert.ok(!body.includes("ft-erp-splash"), "API miss must not return SPA shell");
  });

  it("keeps GET /health registered (not SPA)", async () => {
    // /health hits DB via prisma — may 503 without DB; must not be HTML SPA
    const res = await request(app).get("/health");
    assert.ok([200, 503].includes(res.status));
    assert.ok(!String(res.headers["content-type"] || "").includes("text/html"));
    assert.equal(typeof res.body, "object");
    assert.equal("ok" in res.body, true);
  });
});

describe("createApp without web/", () => {
  it("keeps JSON root when static hosting cannot mount", async () => {
    const app = createApp({
      staticHosting: false,
      env: { NODE_ENV: "development" },
    });
    const res = await request(app).get("/").expect(200);
    assert.equal(res.body.message, "Mini ERP Backend Running");
  });

  it("does not enable hosting when index.html is absent", () => {
    const r = resolveStaticHostingOptions({
      webDir: path.join(os.tmpdir(), "no-such-ft-web-999"),
      env: { NODE_ENV: "production", FT_SERVE_WEB: "1" },
    });
    assert.equal(r.enabled, false);
    assert.equal(r.webDir, null);
  });

  it("FRONTEND_MARKERS include Flowtix brand strings", () => {
    assert.ok(FRONTEND_MARKERS.includes("Flowtix ERP"));
  });
});
