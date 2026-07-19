const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { resolveInstallHome } = require("../../../deployment/lib/resolveInstallHome");

function mkTempLayout(parts) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ft-erp-home-"));
  for (const rel of parts) {
    const full = path.join(root, rel);
    fs.mkdirSync(full, { recursive: true });
  }
  return root;
}

describe("resolveInstallHome (installed tools layout)", () => {
  it("resolves C:/FT-ERP when executed from C:/FT-ERP/tools (shared present)", () => {
    const home = mkTempLayout(["shared", "releases", "tools", "app"]);
    try {
      const toolsDir = path.join(home, "tools");
      assert.equal(resolveInstallHome(toolsDir, {}), home);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("resolves install home when only app/ exists under tools parent", () => {
    const home = mkTempLayout(["app", "tools"]);
    try {
      assert.equal(resolveInstallHome(path.join(home, "tools"), {}), home);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("honors FT_ERP_HOME override", () => {
    const home = mkTempLayout(["tools"]);
    const override = mkTempLayout(["shared"]);
    try {
      assert.equal(
        resolveInstallHome(path.join(home, "tools"), { FT_ERP_HOME: override }),
        override,
      );
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(override, { recursive: true, force: true });
    }
  });

  it("resolves release package tools under home/releases/Flowtix-vX/tools", () => {
    const home = mkTempLayout(["shared", "releases/Flowtix-v1.0.0/tools"]);
    try {
      const toolsDir = path.join(home, "releases", "Flowtix-v1.0.0", "tools");
      assert.equal(resolveInstallHome(toolsDir, {}), home);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
