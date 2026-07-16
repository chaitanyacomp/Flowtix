/**
 * FT-DEP-001 Batch 8 — optional Windows Service helpers (WinSW).
 *
 * Service is optional: if not installed, all helpers no-op successfully.
 * Never touches shared/, backups/, or the database.
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { spawnSync } = require("child_process");

const SERVICE_ID = "FlowtixERP";
const SERVICE_EXE_NAME = "FlowtixERP.exe";
const SERVICE_XML_NAME = "FlowtixERP.xml";
const WINSW_VERSION = "v2.12.0";
const WINSW_URL =
  process.env.WINSW_DOWNLOAD_URL ||
  `https://github.com/winsw/winsw/releases/download/${WINSW_VERSION}/WinSW-x64.exe`;

function serviceDir(home) {
  return path.join(home, "service");
}

function serviceExePath(home) {
  return path.join(serviceDir(home), SERVICE_EXE_NAME);
}

function serviceXmlPath(home) {
  return path.join(serviceDir(home), SERVICE_XML_NAME);
}

function serviceLogDir(home) {
  return path.join(home, "logs", "service");
}

function resolveActiveApp(home) {
  const current = path.join(home, "current", "app");
  if (fs.existsSync(path.join(current, "server.js"))) return current;
  const rootApp = path.join(home, "app");
  if (fs.existsSync(path.join(rootApp, "server.js"))) return rootApp;
  return rootApp;
}

function findNodeExecutable() {
  if (process.env.NODE_EXE && fs.existsSync(process.env.NODE_EXE)) {
    return process.env.NODE_EXE;
  }
  const probe = spawnSync("where", ["node"], {
    encoding: "utf8",
    windowsHide: true,
    shell: true,
  });
  if (!probe.error && probe.status === 0) {
    const first = String(probe.stdout || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)[0];
    if (first) return first;
  }
  return "node";
}

function isAdmin() {
  if (process.platform !== "win32") return false;
  const r = spawnSync("net", ["session"], {
    encoding: "utf8",
    windowsHide: true,
    shell: true,
  });
  return !r.error && r.status === 0;
}

/**
 * @returns {'not_installed'|'stopped'|'running'|'start_pending'|'stop_pending'|'unknown'}
 */
function queryServiceState(serviceId = SERVICE_ID) {
  if (process.platform !== "win32") return "not_installed";
  const r = spawnSync("sc", ["query", serviceId], {
    encoding: "utf8",
    windowsHide: true,
    shell: true,
  });
  const out = `${r.stdout || ""}\n${r.stderr || ""}`;
  if (/FAILED\s+1060|does not exist|specified service does not exist/i.test(out)) {
    return "not_installed";
  }
  if (r.status !== 0 && !/STATE/i.test(out)) return "unknown";
  if (/RUNNING/i.test(out)) return "running";
  if (/STOPPED/i.test(out)) return "stopped";
  if (/START_PENDING/i.test(out)) return "start_pending";
  if (/STOP_PENDING/i.test(out)) return "stop_pending";
  return "unknown";
}

function isServicePresent(serviceId = SERVICE_ID) {
  const s = queryServiceState(serviceId);
  return s !== "not_installed";
}

function runWinSW(home, args) {
  const exe = serviceExePath(home);
  if (!fs.existsSync(exe)) {
    return {
      status: 1,
      stdout: "",
      stderr: `WinSW wrapper missing: ${exe}. Run service-install first.`,
    };
  }
  const r = spawnSync(exe, args, {
    cwd: serviceDir(home),
    encoding: "utf8",
    windowsHide: true,
    timeout: 120000,
  });
  return {
    status: typeof r.status === "number" ? r.status : 1,
    stdout: String(r.stdout || ""),
    stderr: String(r.stderr || ""),
    error: r.error ? String(r.error.message || r.error) : null,
  };
}

function runSc(args) {
  const r = spawnSync("sc", args, {
    encoding: "utf8",
    windowsHide: true,
    shell: true,
    timeout: 60000,
  });
  return {
    status: typeof r.status === "number" ? r.status : 1,
    stdout: String(r.stdout || ""),
    stderr: String(r.stderr || ""),
  };
}

function sleepMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // busy wait — avoid async in sync helpers used by update/rollback
  }
}

function waitForState(want, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = queryServiceState();
    if (want === "stopped" && (s === "stopped" || s === "not_installed")) return s;
    if (want === "running" && s === "running") return s;
    sleepMs(500);
  }
  return queryServiceState();
}

/**
 * Stop service if installed. No-op if not present.
 * @returns {{ present: boolean, attempted: boolean, ok: boolean, state: string, detail: string }}
 */
function stopServiceIfPresent(home) {
  const state = queryServiceState();
  if (state === "not_installed") {
    return {
      present: false,
      attempted: false,
      ok: true,
      state,
      detail: "Service not installed — skip stop (optional).",
    };
  }
  if (state === "stopped") {
    return {
      present: true,
      attempted: false,
      ok: true,
      state,
      detail: "Service already stopped.",
    };
  }

  let result;
  if (fs.existsSync(serviceExePath(home))) {
    result = runWinSW(home, ["stop"]);
  } else {
    result = runSc(["stop", SERVICE_ID]);
  }
  const after = waitForState("stopped", 45000);
  const ok = after === "stopped" || after === "not_installed";
  return {
    present: true,
    attempted: true,
    ok,
    state: after,
    detail: ok
      ? `Service stopped (was ${state}).`
      : `Stop incomplete (state=${after}). ${result.stderr || result.stdout || ""}`.trim(),
  };
}

/**
 * Start service if installed. No-op if not present.
 */
function startServiceIfPresent(home) {
  const state = queryServiceState();
  if (state === "not_installed") {
    return {
      present: false,
      attempted: false,
      ok: true,
      state,
      detail: "Service not installed — skip start (optional).",
    };
  }
  if (state === "running") {
    return {
      present: true,
      attempted: false,
      ok: true,
      state,
      detail: "Service already running.",
    };
  }

  let result;
  if (fs.existsSync(serviceExePath(home))) {
    result = runWinSW(home, ["start"]);
  } else {
    result = runSc(["start", SERVICE_ID]);
  }
  const after = waitForState("running", 60000);
  const ok = after === "running";
  return {
    present: true,
    attempted: true,
    ok,
    state: after,
    detail: ok
      ? "Service started."
      : `Start incomplete (state=${after}). ${result.stderr || result.stdout || ""}`.trim(),
  };
}

function restartServiceIfPresent(home) {
  const stop = stopServiceIfPresent(home);
  if (!stop.present) return { ...stop, phase: "restart" };
  if (!stop.ok) return { ...stop, phase: "restart-stop" };
  const start = startServiceIfPresent(home);
  return {
    present: true,
    attempted: true,
    ok: start.ok,
    state: start.state,
    detail: `Restart: ${stop.detail} → ${start.detail}`,
    phase: "restart",
  };
}

function buildServiceXml(home) {
  const appDir = resolveActiveApp(home);
  const serverJs = path.join(appDir, "server.js");
  const nodeExe = findNodeExecutable();
  const logPath = serviceLogDir(home);
  // WinSW 2.x XML — paths with spaces must be quoted in arguments.
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- FT-DEP-001 Batch 8 — Flowtix ERP Windows Service (WinSW ${WINSW_VERSION}) -->
<!-- Generated for FT_ERP_HOME=${home} — do not put secrets here; app loads shared/.env -->
<service>
  <id>${SERVICE_ID}</id>
  <name>Flowtix ERP Backend</name>
  <description>Flowtix ERP Node.js backend (FT-DEP-001). Optional Windows Service wrapper.</description>
  <executable>${escapeXml(nodeExe)}</executable>
  <arguments>"${escapeXml(serverJs)}"</arguments>
  <workingdirectory>${escapeXml(appDir)}</workingdirectory>
  <logpath>${escapeXml(logPath)}</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>8</keepFiles>
  </log>
  <onfailure action="restart" delay="5 sec"/>
  <onfailure action="restart" delay="10 sec"/>
  <onfailure action="restart" delay="30 sec"/>
  <resetfailure>1 hour</resetfailure>
  <stoptimeout>20 sec</stoptimeout>
  <startmode>Automatic</startmode>
  <env name="FT_ERP_HOME" value="${escapeXml(home)}"/>
  <env name="NODE_ENV" value="production"/>
</service>
`;
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const getter = url.startsWith("https") ? https : http;
    const req = getter.get(url, { headers: { "User-Agent": "Flowtix-FT-DEP-001" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        downloadFile(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        try {
          fs.unlinkSync(dest);
        } catch {
          // ignore
        }
        reject(new Error(`Download failed HTTP ${res.statusCode} for ${url}`));
        return;
      }
      res.pipe(file);
      file.on("finish", () => {
        file.close(() => resolve(dest));
      });
    });
    req.on("error", (err) => {
      try {
        file.close();
        fs.unlinkSync(dest);
      } catch {
        // ignore
      }
      reject(err);
    });
  });
}

function findBundledWinSW() {
  const candidates = [
    // Repo: deployment/vendor/winsw  |  Release: tools/vendor/winsw
    path.join(__dirname, "vendor", "winsw", "WinSW-x64.exe"),
    path.join(__dirname, "vendor", "winsw", "winsw.exe"),
    path.join(__dirname, "..", "vendor", "winsw", "WinSW-x64.exe"),
    path.join(__dirname, "..", "deployment", "vendor", "winsw", "WinSW-x64.exe"),
    path.join(__dirname, "service", "WinSW-x64.exe"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function loadWinswManifest() {
  const candidates = [
    path.join(__dirname, "vendor", "winsw", "winsw-manifest.json"),
    path.join(__dirname, "..", "vendor", "winsw", "winsw-manifest.json"),
  ];
  for (const c of candidates) {
    if (!fs.existsSync(c)) continue;
    try {
      return JSON.parse(fs.readFileSync(c, "utf8"));
    } catch {
      // try next
    }
  }
  return null;
}

function sha256FileSync(filePath) {
  const crypto = require("crypto");
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function assertWinswChecksum(filePath, manifest) {
  if (!manifest || !manifest.sha256) {
    return { ok: true, skipped: true, detail: "manifest sha256 unset — skip verify" };
  }
  const expected = String(manifest.sha256).trim().toLowerCase();
  const actual = sha256FileSync(filePath);
  if (actual !== expected) {
    return {
      ok: false,
      detail: `WinSW checksum mismatch expected=${expected} actual=${actual}`,
    };
  }
  return { ok: true, detail: `sha256=${actual}` };
}

async function ensureWinSWBinary(home) {
  fs.mkdirSync(serviceDir(home), { recursive: true });
  const dest = serviceExePath(home);
  const manifest = loadWinswManifest();

  if (fs.existsSync(dest) && fs.statSync(dest).size > 100000) {
    const chk = assertWinswChecksum(dest, manifest);
    if (!chk.ok) {
      throw new Error(chk.detail);
    }
    return { path: dest, source: "existing", checksum: chk.detail };
  }

  const bundled = findBundledWinSW();
  if (bundled) {
    const chk = assertWinswChecksum(bundled, manifest);
    if (!chk.ok) {
      throw new Error(`Bundled WinSW failed validation: ${chk.detail}`);
    }
    fs.copyFileSync(bundled, dest);
    return { path: dest, source: "vendor", checksum: chk.detail };
  }

  // Last resort: download pinned URL, then verify checksum when manifest is present.
  const tmp = path.join(serviceDir(home), "_WinSW-x64.download.exe");
  await downloadFile(WINSW_URL, tmp);
  const chk = assertWinswChecksum(tmp, manifest);
  if (!chk.ok) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
    throw new Error(`Downloaded WinSW failed validation: ${chk.detail}`);
  }
  fs.renameSync(tmp, dest);
  return { path: dest, source: "download", url: WINSW_URL, checksum: chk.detail };
}

function writeServiceXml(home) {
  fs.mkdirSync(serviceDir(home), { recursive: true });
  fs.mkdirSync(serviceLogDir(home), { recursive: true });
  const xml = buildServiceXml(home);
  fs.writeFileSync(serviceXmlPath(home), xml, "utf8");
  return serviceXmlPath(home);
}

function writeServiceReadme(home) {
  const text = `Flowtix ERP — Windows Service (FT-DEP-001 Batch 8)

Wrapper: WinSW (${WINSW_VERSION}) as ${SERVICE_EXE_NAME}
Config:  ${SERVICE_XML_NAME}
Logs:    ..\\logs\\service\\

Commands (from tools\\ or deployment\\):
  service-install.bat
  service-uninstall.bat
  service-start.bat
  service-stop.bat
  service-restart.bat
  service-status.bat

Service is OPTIONAL. Update/rollback detect presence and stop/start gracefully.
App loads secrets from shared\\.env — do not put passwords in the XML.
`;
  fs.writeFileSync(path.join(serviceDir(home), "README.txt"), text, "utf8");
}

async function installService(home) {
  if (process.platform !== "win32") {
    return { ok: false, detail: "Windows Service install is only supported on win32." };
  }
  if (!isAdmin()) {
    return {
      ok: false,
      detail: "Administrator privileges required to install the Windows Service.",
    };
  }
  const appDir = resolveActiveApp(home);
  if (!fs.existsSync(path.join(appDir, "server.js"))) {
    return { ok: false, detail: `Active app/server.js not found at ${appDir}` };
  }
  if (!fs.existsSync(path.join(home, "shared", ".env"))) {
    return { ok: false, detail: `shared/.env missing at ${path.join(home, "shared", ".env")}` };
  }

  let wrapper;
  try {
    wrapper = await ensureWinSWBinary(home);
  } catch (e) {
    return {
      ok: false,
      detail: `Could not obtain WinSW binary: ${e instanceof Error ? e.message : String(e)}. Place WinSW-x64.exe in deployment/vendor/winsw/ or set WINSW_DOWNLOAD_URL.`,
    };
  }
  writeServiceXml(home);
  writeServiceReadme(home);

  if (isServicePresent()) {
    // Refresh XML / paths; leave running state to operator
    return {
      ok: true,
      detail: `Service already registered. Refreshed XML at ${serviceXmlPath(home)} (wrapper=${wrapper.source}). Use service-restart.bat to apply.`,
      wrapper,
    };
  }

  const r = runWinSW(home, ["install"]);
  if (r.status !== 0) {
    return {
      ok: false,
      detail: `WinSW install failed: ${(r.stderr || r.stdout || r.error || "").trim()}`,
      wrapper,
    };
  }
  return {
    ok: true,
    detail: `Installed service ${SERVICE_ID}. Wrapper from ${wrapper.source}. Start with service-start.bat.`,
    wrapper,
  };
}

function uninstallService(home) {
  if (process.platform !== "win32") {
    return { ok: false, detail: "Windows Service uninstall is only supported on win32." };
  }
  if (!isAdmin()) {
    return {
      ok: false,
      detail: "Administrator privileges required to uninstall the Windows Service.",
    };
  }
  const state = queryServiceState();
  if (state === "not_installed") {
    return { ok: true, detail: "Service was not installed." };
  }
  if (state === "running" || state === "start_pending") {
    stopServiceIfPresent(home);
  }
  let r;
  if (fs.existsSync(serviceExePath(home))) {
    r = runWinSW(home, ["uninstall"]);
  } else {
    r = runSc(["delete", SERVICE_ID]);
  }
  const after = waitForState("stopped", 15000);
  const gone = queryServiceState() === "not_installed";
  return {
    ok: gone || r.status === 0,
    detail: gone
      ? "Service uninstalled."
      : `Uninstall attempted (state=${after}). ${(r.stderr || r.stdout || "").trim()}`,
  };
}

function statusReport(home) {
  const state = queryServiceState();
  return {
    serviceId: SERVICE_ID,
    state,
    present: state !== "not_installed",
    wrapperExists: fs.existsSync(serviceExePath(home)),
    xmlExists: fs.existsSync(serviceXmlPath(home)),
    xmlPath: serviceXmlPath(home),
    exePath: serviceExePath(home),
    logDir: serviceLogDir(home),
    appDir: resolveActiveApp(home),
    admin: isAdmin(),
  };
}

module.exports = {
  SERVICE_ID,
  SERVICE_EXE_NAME,
  SERVICE_XML_NAME,
  WINSW_VERSION,
  WINSW_URL,
  serviceDir,
  serviceExePath,
  serviceXmlPath,
  serviceLogDir,
  resolveActiveApp,
  queryServiceState,
  isServicePresent,
  stopServiceIfPresent,
  startServiceIfPresent,
  restartServiceIfPresent,
  installService,
  uninstallService,
  statusReport,
  writeServiceXml,
  ensureWinSWBinary,
  isAdmin,
  buildServiceXml,
};
