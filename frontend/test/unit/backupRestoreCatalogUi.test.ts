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
  });

  it("documents CLI backups appear after Refresh", () => {
    expect(pageSource).toContain("CLI backups appear here after");
    expect(pageSource).toContain("Refresh");
  });
});

describe("BackupRestorePage Phase 3 safe restore UI", () => {
  it("shows backup date/type/size/users and password revert warning", () => {
    expect(pageSource).toContain("Users and passwords revert to the backup date");
    expect(pageSource).toContain("Users / Admins");
    expect(pageSource).toContain("restore-progress");
    expect(pageSource).toContain("forceUnauthenticatedState");
  });

  it("enables restore from eligibility flag and shows IT-assisted message", () => {
    expect(pageSource).toContain("restoreEligible");
    expect(pageSource).toContain("IT-assisted restore required");
    expect(pageSource).not.toContain("Only manual backups in Created status can be restored");
  });
});

describe("BackupRestorePage Phase 2 schedule status UI", () => {
  it("loads schedule status and shows enabled/time/last success-failure/next run/retention", () => {
    expect(pageSource).toContain('/api/admin/backups/schedule');
    expect(pageSource).toContain("Automatic daily backup");
    expect(pageSource).toContain("automaticBackupEnabled");
    expect(pageSource).toContain("scheduledTimeLocal");
    expect(pageSource).toContain("Last automatic success");
    expect(pageSource).toContain("Last automatic failure");
    expect(pageSource).toContain("Next run");
    expect(pageSource).toContain("Retention (automatic only)");
    expect(pageSource).toContain("backup-schedule-status");
  });

  it("shows a clear Admin warning when latest scheduled backup failed or is overdue", () => {
    expect(pageSource).toContain("backup-schedule-warning");
    expect(pageSource).toContain("Scheduled backup attention required");
    expect(pageSource).toContain("schedule?.warning?.message");
  });
});
