import { test, expect } from "@playwright/test";

test("login screen reaches backend health without mutating ERP data", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "Mini ERP Login" })).toBeVisible();
  await page.getByRole("button", { name: "Test backend connection" }).click();
  await expect(page.getByText("Backend and database OK")).toBeVisible();
});
