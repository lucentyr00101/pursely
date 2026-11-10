import { describe, expect, test } from "bun:test";
import { cutoffIn, dueFor, lastClosed, pickStatement, statementAt, statementChoices, statementFor, statementStart } from "./statements";

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

describe("dueFor", () => {
  test("is the first due day after the statement closes", () => {
    expect(dueFor("2026-11-28", 15)).toBe("2026-12-15");
    expect(dueFor("2026-11-05", 25)).toBe("2026-11-25");
  });
  test("a due day equal to the cutoff falls a month later", () => {
    expect(dueFor("2026-11-15", 15)).toBe("2026-12-15");
  });
  test("clamps in short months", () => {
    expect(dueFor("2026-01-31", 30)).toBe("2026-02-28");
    expect(dueFor("2026-02-28", 31)).toBe("2026-03-31");
  });
});

describe("lastClosed", () => {
  test("is the previous statement while the current one is open", () => {
    expect(lastClosed("2026-11-09", 28)).toBe("2026-10-28");
    expect(lastClosed("2026-11-29", 28)).toBe("2026-11-28");
  });
  test("a statement closing today counts as closed", () => {
    expect(lastClosed("2026-11-28", 28)).toBe("2026-11-28");
  });
});

describe("pickStatement", () => {
  test("a new purchase goes on the automatic statement, unpinned", () => {
    expect(pickStatement("2026-11-29", 28, null, null)).toEqual({ statement: "2026-12-28", pinned: false });
    expect(pickStatement("2026-11-29", 28, "2026-12-28", null)).toEqual({ statement: "2026-12-28", pinned: false });
  });
  test("the previous or next statement, chosen by hand, is pinned", () => {
    expect(pickStatement("2026-11-29", 28, "2026-11-28", null)).toEqual({ statement: "2026-11-28", pinned: true });
    expect(pickStatement("2026-11-29", 28, "2027-01-28", null)).toEqual({ statement: "2027-01-28", pinned: true });
  });
  test("any other statement is refused", () => {
    expect(pickStatement("2026-11-29", 28, "2027-02-28", null)).toBeNull();
    expect(pickStatement("2026-11-29", 28, "2026-12-27", null)).toBeNull();
  });
  test("an edit that leaves date and statement alone keeps the stored one, even after the cutoff changed", () => {
    const stored = { date: "2026-11-29", statement: "2026-12-28" };
    expect(pickStatement("2026-11-29", 15, null, stored)).toBe("keep");
    expect(pickStatement("2026-11-29", 15, "2026-12-28", stored)).toBe("keep");
  });
  test("a new date or a different statement is worked out again", () => {
    const stored = { date: "2026-11-29", statement: "2026-12-28" };
    expect(pickStatement("2026-12-30", 28, null, stored)).toEqual({ statement: "2027-01-28", pinned: false });
    expect(pickStatement("2026-11-29", 28, "2026-11-28", stored)).toEqual({ statement: "2026-11-28", pinned: true });
    // The stored statement isn't one of the new date's choices, so it can't be carried over by hand.
    expect(pickStatement("2027-03-05", 28, "2026-12-28", stored)).toBeNull();
  });
});
