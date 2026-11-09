import { describe, expect, test } from "bun:test";
import { addMonths, buckets, daysBetween, endOf, isIsoDate, resolveRange, startOf } from "./dates";

describe("addMonths", () => {
  test("clamps to the last day of a shorter month", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
  });
  test("crosses years", () => {
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-01-15", -13)).toBe("2024-12-15");
  });
});

describe("startOf and endOf", () => {
  test("weeks start on Monday", () => {
    expect(startOf("2026-11-15", "week")).toBe("2026-11-09"); // a Sunday
    expect(startOf("2026-11-09", "week")).toBe("2026-11-09"); // a Monday
    expect(endOf("2026-11-11", "week")).toBe("2026-11-15");
  });
  test("months and years", () => {
    expect(startOf("2026-11-09", "month")).toBe("2026-11-01");
    expect(endOf("2026-02-10", "month")).toBe("2026-02-28");
    expect(endOf("2028-02-10", "month")).toBe("2028-02-29");
    expect(startOf("2026-11-09", "year")).toBe("2026-01-01");
    expect(endOf("2026-11-09", "year")).toBe("2026-12-31");
  });
});

test("buckets cover the range from the bucket containing its start", () => {
  expect(buckets("2026-11-04", "2026-11-20", "week")).toEqual(["2026-11-02", "2026-11-09", "2026-11-16"]);
  expect(buckets("2026-11-30", "2027-01-01", "month")).toEqual(["2026-11-01", "2026-12-01", "2027-01-01"]);
});

test("daysBetween counts both ends", () => {
  expect(daysBetween("2026-11-01", "2026-11-30")).toBe(30);
  expect(daysBetween("2026-11-09", "2026-11-09")).toBe(1);
});

test("isIsoDate accepts only YYYY-MM-DD strings", () => {
  expect(isIsoDate("2026-11-09")).toBe(true);
  expect(isIsoDate("2026-11-9")).toBe(false);
  expect(isIsoDate({ $ne: "" })).toBe(false);
});

describe("resolveRange", () => {
  const today = "2026-11-11";

  test("defaults to this month by day", () => {
    const r = resolveRange({}, today);
    expect([r.preset, r.from, r.to, r.group]).toEqual(["month", "2026-11-01", "2026-11-30", "day"]);
  });
  test("shifts presets back by offset, never forward", () => {
    expect(resolveRange({ preset: "month", offset: "-1" }, today)).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    expect(resolveRange({ preset: "month", offset: "5" }, today)).toMatchObject({ from: "2026-11-01", to: "2026-11-30" });
    expect(resolveRange({ preset: "week" }, today)).toMatchObject({ from: "2026-11-09", to: "2026-11-15" });
  });
  test("last N months starts at the beginning of the earliest month", () => {
    const r = resolveRange({ preset: "last", n: "3", unit: "month" }, today);
    expect([r.from, r.to, r.group]).toEqual(["2026-09-01", today, "month"]);
  });
  test("custom swaps reversed dates", () => {
    expect(resolveRange({ preset: "custom", from: "2026-12-01", to: "2026-01-01" }, today)).toMatchObject({
      from: "2026-01-01",
      to: "2026-12-01",
    });
  });
  test("coarsens a grouping that would draw more than 400 bars", () => {
    const r = resolveRange({ preset: "custom", from: "2006-01-01", to: "2025-12-31", group: "day" }, today);
    expect(r.group).toBe("month");
    expect(r.groupAdjusted).toBe(true);
  });
});
