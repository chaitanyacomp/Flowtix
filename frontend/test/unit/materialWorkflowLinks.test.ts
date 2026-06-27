import { describe, expect, it } from "vitest";
import {
  formatPostWoCreateSuccessMessage,
  materialWorkflowBackHref,
  postWoMaterialIssueHref,
} from "../../src/lib/materialWorkflowLinks";

describe("materialWorkflowLinks", () => {
  it("builds Material Issue href with pmrId and session scope when available", () => {
    expect(
      postWoMaterialIssueHref({
        workOrderId: 42,
        pmrId: 7,
        returnTo: "work-orders",
        requirementSheetId: 99,
        salesOrderId: 4,
      }),
    ).toBe("/material-issue?pmrId=7&workOrderId=42&returnTo=work-orders&requirementSheetId=99&salesOrderId=4");
  });

  it("falls back to workOrderId-only Material Issue href when pmrId is missing", () => {
    expect(postWoMaterialIssueHref({ workOrderId: 42, returnTo: "pending-actions" })).toBe(
      "/material-issue?workOrderId=42&returnTo=pending-actions",
    );
  });

  it("formats post-WO success message with PMR doc no", () => {
    expect(formatPostWoCreateSuccessMessage("Work Order WO-26-0001", "PMR-26-0003")).toContain(
      "Work Order WO-26-0001 created.",
    );
    expect(formatPostWoCreateSuccessMessage("Work Order WO-26-0001", "PMR-26-0003")).toContain(
      "PMR PMR-26-0003 is ready.",
    );
    expect(formatPostWoCreateSuccessMessage("Work Order WO-26-0001", "PMR-26-0003")).toContain(
      "Continue to issue material.",
    );
  });

  it("resolves workflow back href from returnTo tokens", () => {
    expect(materialWorkflowBackHref("pending-actions")).toBe("/pending-actions");
    expect(materialWorkflowBackHref("work-orders")).toBe("/work-orders");
    expect(materialWorkflowBackHref("rm-purchase")).toBe("/rm-po-grn");
    expect(materialWorkflowBackHref("production-workspace", 99)).toBe("/production?workOrderId=99");
  });
});
