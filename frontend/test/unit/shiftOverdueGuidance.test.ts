import { describe, expect, it } from "vitest";
import {
  SHIFT_OVERDUE_MESSAGE,
  addCalendarDay,
  evaluateOpenShiftOverdue,
} from "../../src/lib/shiftOverdueGuidance";

describe("shiftOverdueGuidance (frontend)", () => {
  it("Morning A 06:00–14:00 is overdue after scheduled end and not overdue during the shift", () => {
    const input = {
      status: "OPEN",
      sessionDate: "2026-08-26",
      startTime: "06:00",
      endTime: "14:00",
    };
    const during = evaluateOpenShiftOverdue(input, new Date("2026-08-26T13:00:00+05:30"));
    expect(during.overdue).toBe(false);
    expect(during.isOvernight).toBe(false);
    expect(during.message).toBeNull();

    const after = evaluateOpenShiftOverdue(input, new Date("2026-08-27T07:00:00+05:30"));
    expect(after.overdue).toBe(true);
    expect(after.message).toBe(SHIFT_OVERDUE_MESSAGE);
    expect(String(after.expectedEndAt)).toContain("2026-08-26T08:30:00.000Z");
  });

  it("overnight 22:00–06:00 ends the next calendar day", () => {
    const input = {
      status: "OPEN",
      sessionDate: "2026-08-26",
      startTime: "22:00",
      endTime: "06:00",
    };
    expect(addCalendarDay("2026-08-26")).toBe("2026-08-27");

    expect(evaluateOpenShiftOverdue(input, new Date("2026-08-26T23:30:00+05:30")).overdue).toBe(false);
    expect(evaluateOpenShiftOverdue(input, new Date("2026-08-27T05:59:00+05:30")).overdue).toBe(false);
    expect(evaluateOpenShiftOverdue(input, new Date("2026-08-27T06:00:01+05:30")).overdue).toBe(true);
  });

  it("SHIFT_OVER is not overdue", () => {
    expect(
      evaluateOpenShiftOverdue(
        { status: "SHIFT_OVER", sessionDate: "2026-08-26", startTime: "06:00", endTime: "14:00" },
        new Date("2026-08-27T07:00:00+05:30"),
      ).overdue,
    ).toBe(false);
  });
});
