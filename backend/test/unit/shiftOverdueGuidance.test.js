const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  SHIFT_OVERDUE_MESSAGE,
  addCalendarDay,
  evaluateOpenShiftOverdue,
} = require("../../src/services/shiftOverdueGuidance");

describe("shiftOverdueGuidance", () => {
  it("Morning A 06:00–14:00 is overdue after scheduled end and not overdue during the shift", () => {
    const input = {
      status: "OPEN",
      sessionDate: "2026-08-26",
      startTime: "06:00",
      endTime: "14:00",
    };
    const during = evaluateOpenShiftOverdue(input, new Date("2026-08-26T13:00:00+05:30"));
    assert.equal(during.overdue, false);
    assert.equal(during.isOvernight, false);
    assert.equal(during.message, null);

    const after = evaluateOpenShiftOverdue(input, new Date("2026-08-27T07:00:00+05:30"));
    assert.equal(after.overdue, true);
    assert.equal(after.message, SHIFT_OVERDUE_MESSAGE);
    assert.match(String(after.expectedEndAt), /2026-08-26T08:30:00\.000Z/);
  });

  it("overnight 22:00–06:00 ends the next calendar day", () => {
    const input = {
      status: "OPEN",
      sessionDate: "2026-08-26",
      startTime: "22:00",
      endTime: "06:00",
    };
    assert.equal(addCalendarDay("2026-08-26"), "2026-08-27");

    const duringNight = evaluateOpenShiftOverdue(input, new Date("2026-08-26T23:30:00+05:30"));
    assert.equal(duringNight.overdue, false);
    assert.equal(duringNight.isOvernight, true);

    const beforeEnd = evaluateOpenShiftOverdue(input, new Date("2026-08-27T05:59:00+05:30"));
    assert.equal(beforeEnd.overdue, false);

    const afterEnd = evaluateOpenShiftOverdue(input, new Date("2026-08-27T06:00:01+05:30"));
    assert.equal(afterEnd.overdue, true);
    assert.equal(afterEnd.message, SHIFT_OVERDUE_MESSAGE);
  });

  it("SHIFT_OVER and missing times are not overdue and never auto-close", () => {
    assert.equal(
      evaluateOpenShiftOverdue(
        { status: "SHIFT_OVER", sessionDate: "2026-08-26", startTime: "06:00", endTime: "14:00" },
        new Date("2026-08-27T07:00:00+05:30"),
      ).overdue,
      false,
    );
    assert.equal(
      evaluateOpenShiftOverdue({ status: "OPEN", sessionDate: "2026-08-26" }, new Date()).overdue,
      false,
    );
  });
});
