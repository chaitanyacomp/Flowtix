/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ERP_ROLES, ERP_ROLE_LABEL } from "../../src/config/erpRoles";

const adminUsersPagePath = resolve(__dirname, "../../src/pages/AdminUsersPage.tsx");
const adminUsersPageSource = readFileSync(adminUsersPagePath, "utf8");

describe("Admin Users role options", () => {
  it("ERP_ROLES includes PRODUCTION_MANAGER with Production Manager label", () => {
    expect(ERP_ROLES).toContain("PRODUCTION_MANAGER");
    expect(ERP_ROLE_LABEL.PRODUCTION_MANAGER).toBe("Production Manager");
    expect(ERP_ROLE_LABEL.ADMIN).toBe("Admin");
    expect(ERP_ROLE_LABEL.STORE).toBe("Store");
    expect(ERP_ROLE_LABEL.PURCHASE).toBe("Purchase");
    expect(ERP_ROLE_LABEL.PRODUCTION).toBe("Production");
    expect(ERP_ROLE_LABEL.QA).toBe("QA");
  });

  it("AdminUsersPage uses shared ERP role source for dropdowns and filter", () => {
    expect(adminUsersPageSource).toContain('from "../config/erpRoles"');
    expect(adminUsersPageSource).toContain("const ROLES = ERP_ROLES");
    expect(adminUsersPageSource).toContain("const ROLE_LABEL = ERP_ROLE_LABEL");
    expect(adminUsersPageSource).not.toMatch(
      /const ROLES:\s*UserRole\[\]\s*=\s*\["ADMIN", "STORE", "PURCHASE", "PRODUCTION", "QA"\]/,
    );
  });
});
