import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DASHBOARD_PAGE = path.resolve(__dirname, "../../src/pages/DashboardPage.tsx");

describe("Admin dashboard copy encoding", () => {
  it("has no corrupted user-facing separators (? standing in for · / —)", () => {
    const src = fs.readFileSync(DASHBOARD_PAGE, "utf8");
    const forbidden = [
      "Factory execution ?",
      "Commercial pipeline clear ?",
      "Operations clear ?",
      "Guided workflow ?",
      "blocked ?",
      "title} ?",
      "> ? {description}",
      "pending ?",
      "NO_QTY ?",
      "regular ?",
    ];
    for (const needle of forbidden) {
      expect(src.includes(needle), `found corrupted fragment: ${needle}`).toBe(false);
    }
    expect(src).toContain("Factory execution · Production · QA · Dispatch");
    expect(src).toContain("Commercial pipeline clear");
  });
});
