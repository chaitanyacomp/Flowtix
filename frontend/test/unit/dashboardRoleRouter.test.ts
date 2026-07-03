import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function readSrc(relativePath: string): string {
  return readFileSync(join(root, "src", relativePath), "utf8");
}

const ADMIN_ONLY_DASHBOARD_APIS = [
  "/api/dashboard/paused-work-orders",
  "/api/dashboard/qc-queue",
  "/api/dashboard/wo-prepare-queues",
  "/api/production/qc-rejected-dispositions/queues",
  "/api/dashboard/quotations-pending-so",
  "/api/dashboard/purchase-summary",
  "/api/dashboard/procurement-pending",
  "/api/dashboard/rm-risk",
];

describe("dashboard role API isolation", () => {
  it("StoreDashboardPage does not reference admin/purchase/qa/production-only dashboard APIs", () => {
    const source = readSrc("pages/store/StoreDashboardPage.tsx");
    for (const endpoint of ADMIN_ONLY_DASHBOARD_APIS) {
      expect(source).not.toContain(endpoint);
    }
  });

  it("DashboardRoleRouter mounts role-specific pages before shared admin dashboard", () => {
    const source = readSrc("pages/dashboard/DashboardRoleRouter.tsx");
    expect(source).toContain('case "STORE"');
    expect(source).toContain("<StoreDashboardPage />");
    expect(source).toContain('case "PURCHASE"');
    expect(source).toContain('case "QA"');
    expect(source).toContain('AdminOperationalDashboardPage role="PRODUCTION"');
    expect(source).toContain('AdminOperationalDashboardPage role="ADMIN"');
  });

  it("AdminOperationalDashboardPage is not exported as the default dashboard entry from App", () => {
    const appSource = readSrc("App.tsx");
    expect(appSource).toContain("./pages/dashboard/DashboardRoleRouter");
    expect(appSource).not.toMatch(/from "\.\/pages\/DashboardPage"/);
  });
});
