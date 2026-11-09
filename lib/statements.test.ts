import { describe, expect, test } from "bun:test";
import { cutoffIn, statementAt, statementChoices, statementFor, statementStart } from "./statements";

describe("cutoffIn", () => {
  test("uses the cutoff day in the month", () => {
    expect(cutoffIn("2026-11-09", 28)).toBe("2026-11-28");
  });
  test("clamps a cutoff past the end of a short month", () => {
    expect(cutoffIn("2026-02-10", 31)).toBe("2026-02-28");
    expect(cutoffIn("2028-02-10", 30)).toBe("2028-02-29");
  });
});

describe("statementFor", () => {
  test("the cutoff day belongs to the statement that closes that day", () => {
    expect(statementFor("2026-11-28", 28)).toBe("2026-11-28");
  });
  test("the day after the cutoff goes on next month's statement", () => {
    expect(statementFor("2026-11-29", 28)).toBe("2026-12-28");
    expect(statementFor("2026-12-29", 28)).toBe("2027-01-28");
  });
  test("a cutoff on the 31st closes on the last day of short months", () => {
    expect(statementFor("2026-02-28", 31)).toBe("2026-02-28");
    expect(statementFor("2026-03-01", 31)).toBe("2026-03-31");
    expect(statementFor("2026-01-31", 31)).toBe("2026-01-31");
  });
  test("moves by whole statements with an offset", () => {
    expect(statementFor("2026-11-29", 28, -1)).toBe("2026-11-28");
    expect(statementFor("2026-11-29", 28, 1)).toBe("2027-01-28");
    expect(statementFor("2026-01-15", 31, 1)).toBe("2026-02-28");
  });
});

test("statementChoices lists the previous, automatic and next statement", () => {
  expect(statementChoices("2026-11-29", 28)).toEqual(["2026-11-28", "2026-12-28", "2027-01-28"]);
});

describe("statementAt", () => {
  test("offset 0 is the statement a purchase today goes on", () => {
    expect(statementAt("2026-11-09", 28, 0)).toBe("2026-11-28");
    expect(statementAt("2026-11-29", 28, 0)).toBe("2026-12-28");
  });
  test("steps any number of statements either way", () => {
    expect(statementAt("2026-11-09", 28, -1)).toBe("2026-10-28");
    expect(statementAt("2026-11-09", 28, -11)).toBe("2025-12-28");
    expect(statementAt("2026-11-09", 31, -9)).toBe("2026-02-28");
  });
});

describe("statementStart", () => {
  test("is the day after the previous cutoff", () => {
    expect(statementStart("2026-11-28", 28)).toBe("2026-10-29");
    expect(statementStart("2026-01-31", 31)).toBe("2026-01-01");
  });
  test("follows a clamped cutoff in a short month", () => {
    expect(statementStart("2026-03-31", 31)).toBe("2026-03-01");
  });
});
