/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pagePath = resolve(__dirname, "../../src/pages/BackupRestorePage.tsx");
const pageSource = readFileSync(pagePath, "utf8");

describe("BackupRestorePage Phase 1 catalog UI", () => {
  it("shows source labels for MANUAL, DEPLOYMENT, AUTOMATIC, PRE_RESTORE", () => {
    expect(pageSource).toContain('if (t === "MANUAL") return "Manual"');
    expect(pageSource).toContain('if (t === "DEPLOYMENT") return "Deployment"');
    expect(pageSource).toContain('if (t === "AUTOMATIC") return "Automatic"');
    expect(pageSource).toContain("Pre-restore");
  });

  it("flags zero-user / zero-admin validation warnings without exposing paths", () => {
    expect(pageSource).toContain("ZERO_USERS");
    expect(pageSource).toContain("ZERO_ACTIVE_ADMINS");
    expect(pageSource).toContain("Validation warning");
    expect(pageSource).not.toMatch(/filePath/);
    expect(pageSource).toContain("Only manual backups in Created status can be restored");
  });

  it("documents CLI backups appear after Refresh", () => {
    expect(pageSource).toContain("CLI backups appear here after");
    expect(pageSource).toContain("Refresh");
  });
});
