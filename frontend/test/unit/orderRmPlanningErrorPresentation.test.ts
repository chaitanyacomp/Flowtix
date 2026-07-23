import { describe, expect, it } from "vitest";

import { presentOperationalError } from "../../src/lib/operationalErrorPresentation";
import { ApiRequestError } from "../../src/services/api";

describe("Order RM Planning runtime error presentation", () => {
  it("shows a safe actionable reference without exposing the Prisma exception", () => {
    const result = presentOperationalError(
      new ApiRequestError(
        "Order RM Planning could not be calculated because its server query is incompatible with the current data model.",
        500,
        "ORDER_RM_PLANNING_QUERY_FAILED",
      ),
    );

    expect(result.userMessage).toContain("ORDER_RM_PLANNING_QUERY_FAILED");
    expect(result.userMessage).not.toMatch(/prisma|stack|findMany/i);
    expect(result.technicalDetail).toContain("current data model");
  });
});
