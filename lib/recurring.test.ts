import { describe, expect, test } from "bun:test";
import { describeSchedule, firstOccurrence, keepEnd, lastWithin, monthlyTotals, occurrence, perMonth, remaining } from "./recurring";

describe("occurrence", () => {
  test("a month-end start clamps in short months and recovers after them", () => {
    expect(occurrence("2026-01-31", "month", 1, 1)).toBe("2026-02-28");
    expect(occurrence("2026-01-31", "month", 1, 2)).toBe("2026-03-31");
  });
  test("weeks and days step by the interval", () => {
    expect(occurrence("2026-11-09", "week", 2, 3)).toBe("2026-12-21");
    expect(occurrence("2026-11-09", "day", 10, 3)).toBe("2026-12-09");
  });
  test("a leap-day yearly rule returns to Feb 29 in leap years", () => {
    expect(occurrence("2024-02-29", "year", 1, 1)).toBe("2025-02-28");
    expect(occurrence("2024-02-29", "year", 1, 4)).toBe("2028-02-29");
  });
});

test("firstOccurrence snaps only monthly card rules to the statement cutoff", () => {
  expect(firstOccurrence("2026-11-29", "month", 28)).toBe("2026-12-28");
  expect(firstOccurrence("2026-11-29", "week", 28)).toBe("2026-11-29");
  expect(firstOccurrence("2026-11-29", "month")).toBe("2026-11-29");
});

test("keepEnd moves an end the new start passed", () => {
  expect(keepEnd("2026-11-10", "2026-11-01", "2026-11-20")).toBe("2026-11-20");
  expect(keepEnd("2026-12-31", "2026-11-01", "2026-11-20")).toBe("2026-12-31");
});

test("lastWithin stops before the period after the run", () => {
  expect(lastWithin("2026-11-20", "month", 1, 6, "month")).toBe("2027-04-20");
  expect(lastWithin("2026-11-02", "week", 1, 1, "month")).toBe("2026-11-30");
});

describe("remaining", () => {
  test("counts occurrences from next through end", () => {
    expect(remaining("2026-01-01", "month", 1, "2026-03-01", "2026-06-01")).toBe(4);
  });
  test("gives up past the cap", () => {
    expect(remaining("2026-01-01", "day", 1, "2026-01-01", "2030-01-01")).toBeNull();
  });
});

test("describeSchedule", () => {
  expect(describeSchedule("month", 1, "2026-11-15")).toBe("Monthly on the 15th");
  expect(describeSchedule("month", 1, "2026-11-22")).toBe("Monthly on the 22nd");
  expect(describeSchedule("month", 3, "2026-11-11")).toBe("Every 3 months on the 11th");
  expect(describeSchedule("week", 2, "2026-11-09")).toBe("Every 2 weeks on Monday");
  expect(describeSchedule("year", 1, "2026-11-09")).toBe("Yearly on November 9");
});

test("monthlyTotals counts only running rules", () => {
  expect(perMonth("month", 2)).toBe(0.5);
  const totals = monthlyTotals([
    { type: "expense", amount: 1000, unit: "month", every: 1, paused: false, nextDate: "2026-12-01" },
    { type: "expense", amount: 1200, unit: "year", every: 1, paused: false, nextDate: "2026-12-01" },
    { type: "expense", amount: 5000, unit: "month", every: 1, paused: true, nextDate: "2026-12-01" },
    { type: "income", amount: 3000, unit: "month", every: 1, paused: false, nextDate: null },
  ]);
  expect(totals).toEqual({ expense: 1100, income: 0, net: -1100 });
});
