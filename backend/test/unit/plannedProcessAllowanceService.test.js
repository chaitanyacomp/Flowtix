const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calculatePlannedProcessAllowance,
  validatePlannedProcessAllowance,
  assessIssueAgainstPlannedAllowance,
  applicableBomRequirement,
  defaultIssueNowQty,
  recoverIncludedRunnerQty,
} = require("../../src/services/plannedProcessAllowanceService");

test("zero Add Qty → Qty BOM, 0%, Issue Now = applicable BOM", () => {
  assert.deepEqual(calculatePlannedProcessAllowance(72, 0), {
    theoreticalBomQty: 72,
    applicableBomQty: 72,
    allowanceInputSource: "QUANTITY",
    enteredAllowancePct: null,
    enteredAllowanceQty: 0,
    plannedAllowancePct: 0,
    plannedAllowanceQty: 0,
    recommendedIssueQty: 72,
    requiresAdminApproval: false,
  });
});

test("Add Qty 1.5 on BOM 40.5 → Allowance % 3.7037 and Issue Now 42", () => {
  const result = calculatePlannedProcessAllowance(40.5, 1.5);
  assert.equal(result.allowanceInputSource, "QUANTITY");
  assert.equal(result.applicableBomQty, 40.5);
  assert.equal(result.enteredAllowanceQty, 1.5);
  assert.equal(result.enteredAllowancePct, null);
  assert.equal(result.plannedAllowanceQty, 1.5);
  assert.equal(result.plannedAllowancePct, 3.7037);
  assert.equal(result.recommendedIssueQty, 42);
  assert.equal(defaultIssueNowQty(40.5, 1.5, 0), 42);
});

test("Allowance % = Add Qty ÷ applicable BOM (not ÷ Issue Now)", () => {
  const result = calculatePlannedProcessAllowance(27, 1);
  assert.equal(result.recommendedIssueQty, 28);
  assert.equal(result.plannedAllowanceQty, 1);
  assert.equal(result.plannedAllowancePct, 3.7037);
});

test("partial prior issue: Qty BOM is remaining; % and Issue Now do not double-count", () => {
  assert.equal(applicableBomRequirement(40.5, 0), 40.5);
  assert.equal(applicableBomRequirement(40.5, 20), 20.5);
  assert.equal(applicableBomRequirement(40.5, 40.5), 0);
  assert.equal(defaultIssueNowQty(40.5, 1.5, 20), 22);

  const afterPartial = calculatePlannedProcessAllowance(40.5, 1.5, 20);
  assert.equal(afterPartial.applicableBomQty, 20.5);
  assert.equal(afterPartial.recommendedIssueQty, 22);
  // 1.5 / 20.5 × 100 ≈ 7.3171 → approval band
  assert.equal(afterPartial.plannedAllowancePct, 7.3171);
  assert.equal(afterPartial.requiresAdminApproval, true);

  // BOM fully covered: Issue Now = Add Qty only; % vs original BOM
  const afterFull = calculatePlannedProcessAllowance(40.5, 1.5, 40.5);
  assert.equal(afterFull.applicableBomQty, 0);
  assert.equal(afterFull.recommendedIssueQty, 1.5);
  assert.equal(afterFull.plannedAllowancePct, 3.7037);
});

test("partial Issue Now below applicable BOM + Add Qty is below target", () => {
  assert.deepEqual(
    assessIssueAgainstPlannedAllowance({
      issueQty: 10,
      theoreticalBomQty: 40.5,
      alreadyIssuedQty: 0,
      extraAllowanceQty: 1.5,
    }),
    {
      applicableBomQty: 40.5,
      targetIssueQty: 42,
      trueShortQty: 30.5,
      belowRecommendedQty: 32,
      excessIssueQty: 0,
    },
  );
  assert.deepEqual(
    assessIssueAgainstPlannedAllowance({
      issueQty: 22,
      theoreticalBomQty: 40.5,
      alreadyIssuedQty: 20,
      extraAllowanceQty: 1.5,
    }),
    {
      applicableBomQty: 20.5,
      targetIssueQty: 22,
      trueShortQty: 0,
      belowRecommendedQty: 0,
      excessIssueQty: 0,
    },
  );
});

test("excess is measured above applicable BOM + Add Qty for this issue", () => {
  assert.deepEqual(
    assessIssueAgainstPlannedAllowance({
      issueQty: 43,
      theoreticalBomQty: 40.5,
      alreadyIssuedQty: 0,
      extraAllowanceQty: 1.5,
    }),
    {
      applicableBomQty: 40.5,
      targetIssueQty: 42,
      trueShortQty: 0,
      belowRecommendedQty: 0,
      excessIssueQty: 1,
    },
  );
});

test("negative Add Qty and above-10% are rejected", () => {
  assert.throws(() => calculatePlannedProcessAllowance(72, -0.1), { code: "PLANNED_ALLOWANCE_NEGATIVE" });
  assert.throws(() => calculatePlannedProcessAllowance(72, 7.3), { code: "PLANNED_ALLOWANCE_INITIAL_ISSUE_LIMIT" });
});

test("above 5% Add Qty requires reason and ADMIN approval", () => {
  assert.throws(
    () =>
      validatePlannedProcessAllowance(
        { theoreticalBomQty: 72, enteredAllowanceQty: 4 },
        { role: "STORE" },
      ),
    { code: "PLANNED_ALLOWANCE_REASON_REQUIRED" },
  );
  assert.throws(
    () =>
      validatePlannedProcessAllowance(
        { theoreticalBomQty: 72, enteredAllowanceQty: 4, allowanceReason: "Trial run" },
        { role: "STORE" },
      ),
    { code: "PLANNED_ALLOWANCE_ADMIN_APPROVAL_REQUIRED" },
  );
  assert.equal(
    validatePlannedProcessAllowance(
      { theoreticalBomQty: 72, enteredAllowanceQty: 4, allowanceReason: "Trial run" },
      { role: "ADMIN" },
    ).approvalStatus,
    "APPROVED",
  );
});

test("server rejects PERCENT source and any client-supplied Allowance %", () => {
  assert.throws(
    () =>
      validatePlannedProcessAllowance(
        {
          theoreticalBomQty: 40.5,
          allowanceInputSource: "PERCENT",
          enteredAllowancePct: 3.7,
        },
        { role: "STORE" },
      ),
    { code: "PLANNED_ALLOWANCE_PERCENT_NOT_ACCEPTED" },
  );
  assert.throws(
    () =>
      validatePlannedProcessAllowance(
        {
          theoreticalBomQty: 40.5,
          allowanceInputSource: "QUANTITY",
          enteredAllowanceQty: 1.5,
          enteredAllowancePct: 3.7,
        },
        { role: "STORE" },
      ),
    { code: "PLANNED_ALLOWANCE_PERCENT_NOT_ACCEPTED" },
  );
});

test("server rejects manipulated calculated quantity / recommendation", () => {
  assert.throws(
    () =>
      validatePlannedProcessAllowance(
        {
          theoreticalBomQty: 40.5,
          allowanceInputSource: "QUANTITY",
          enteredAllowanceQty: 1.5,
          plannedAllowanceQty: 2,
          recommendedIssueQty: 42,
        },
        { role: "STORE" },
      ),
    { code: "PLANNED_ALLOWANCE_CALCULATION_MISMATCH" },
  );
  assert.throws(
    () =>
      validatePlannedProcessAllowance(
        {
          theoreticalBomQty: 40.5,
          allowanceInputSource: "QUANTITY",
          enteredAllowanceQty: 1.5,
          plannedAllowanceQty: 1.5,
          recommendedIssueQty: 50,
        },
        { role: "STORE" },
      ),
    { code: "PLANNED_ALLOWANCE_CALCULATION_MISMATCH" },
  );
});

test("server derives allowance from Issue Now and rejects stale Add Qty", () => {
  const result = validatePlannedProcessAllowance(
    {
      theoreticalBomQty: 22.8,
      alreadyIssuedQty: 0,
      issueQty: 25,
      enteredAllowanceQty: 2.2,
      allowanceReason: "Process setup allowance",
    },
    { role: "ADMIN" },
  );
  assert.equal(result.plannedAllowanceQty, 2.2);
  assert.equal(result.plannedAllowancePct, 9.6491);
  assert.equal(result.requiresAdminApproval, true);
  assert.throws(
    () => validatePlannedProcessAllowance(
      { theoreticalBomQty: 22.8, issueQty: 25, enteredAllowanceQty: 1, allowanceReason: "stale" },
      { role: "ADMIN" },
    ),
    { code: "PLANNED_ALLOWANCE_CALCULATION_MISMATCH" },
  );
});

test("Issue Now below the remaining BOM is partial issue with zero allowance", () => {
  const result = validatePlannedProcessAllowance(
    { theoreticalBomQty: 22.8, issueQty: 20, enteredAllowanceQty: 0 },
    { role: "STORE" },
  );
  assert.equal(result.plannedAllowanceQty, 0);
  assert.equal(result.plannedAllowancePct, 0);
  assert.equal(result.requiresAdminApproval, false);
});

test("included runner is recovered from theoretical and never added again", () => {
  assert.equal(recoverIncludedRunnerQty(27, 90, 10), 2.7);
  const planned = calculatePlannedProcessAllowance(27, 0);
  assert.equal(planned.recommendedIssueQty, 27);
  assert.notEqual(planned.recommendedIssueQty, 27 + recoverIncludedRunnerQty(27, 90, 10));
});
