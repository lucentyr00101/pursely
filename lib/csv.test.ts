import { describe, expect, test } from "bun:test";
import { MAX_IMPORT_ROWS, parseCsv, readImport } from "./csv";

describe("parseCsv", () => {
  test("splits rows and cells", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });
  test("reads quoted cells with commas, quotes and line breaks", () => {
    expect(parseCsv('note,amount\r\n"Lunch, with ""Sam""\nand Jo",12.50\r\n')).toEqual([
      ["note", "amount"],
      ['Lunch, with "Sam"\nand Jo', "12.50"],
    ]);
  });
  test("drops a byte order mark and blank lines", () => {
    expect(parseCsv("﻿date,amount\n\n2026-01-31,5\n\n")).toEqual([
      ["date", "amount"],
      ["2026-01-31", "5"],
    ]);
  });
  test("uses semicolons when the header does", () => {
    expect(parseCsv("date;amount;note\n2026-01-31;5;a,b")).toEqual([
      ["date", "amount", "note"],
      ["2026-01-31", "5", "a,b"],
    ]);
  });
  test("keeps empty cells and a last row with no line break", () => {
    expect(parseCsv("a,b,c\n1,,3")).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
    ]);
  });
});

describe("readImport", () => {
  const read = (text: string) => {
    const result = readImport(parseCsv(text));
    if (typeof result === "string") throw new Error(result);
    return result;
  };

  test("reads the export's columns", () => {
    const { rows, errors } = read(
      '"date","type","category","subcategory","amount","paid_with","statement","note"\n' +
        '"2026-11-05","expense","Food & Dining","Groceries","1,234.50","RCBC Black ••4444","2026-11-28","Weekly shop"\n' +
        '"2026-11-06","income","Salary","","50000.00","","","Pay"\n',
    );
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { line: 2, date: "2026-11-05", type: "expense", amount: 123450, category: "Food & Dining", subcategory: "Groceries", note: "Weekly shop", paidWith: "RCBC Black ••4444", statement: "2026-11-28" },
      { line: 3, date: "2026-11-06", type: "income", amount: 5000000, category: "Salary", subcategory: "", note: "Pay", paidWith: "", statement: null },
    ]);
  });
  test("needs only date and amount, in any order and letter case", () => {
    const { rows } = read("Amount,Date\n12,2026-01-31\n");
    expect(rows).toEqual([
      { line: 2, date: "2026-01-31", type: "expense", amount: 1200, category: "", subcategory: "", note: "", paidWith: "", statement: null },
    ]);
  });
  test("accepts 'Paid with' as a header", () => {
    expect(read("date,amount,Paid with\n2026-01-31,5,Cash\n").rows[0].paidWith).toBe("Cash");
  });
  test("income carries no payment method or statement", () => {
    const [row] = read("date,type,amount,paid_with,statement\n2026-01-31,Income,5,Cash,2026-02-28\n").rows;
    expect(row).toMatchObject({ type: "income", paidWith: "", statement: null });
  });
  test("reports rows it can't read by line and keeps the rest", () => {
    const { rows, errors } = read("date,amount,type\n01/31/2026,5,\n2026-01-31,-5,\n2026-01-31,5,transfer\n2026-02-01,7,\n");
    expect(rows.map((r) => r.line)).toEqual([5]);
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4]);
  });
  test("drops the apostrophe the export puts before a formula-like note", () => {
    expect(read("date,amount,note\n2026-01-31,5,'=SUM(A1)\n").rows[0].note).toBe("=SUM(A1)");
    expect(read("date,amount,note\n2026-01-31,5,'til Friday\n").rows[0].note).toBe("'til Friday");
  });
  test("cuts a note at 200 characters and ignores a statement that isn't a date", () => {
    const [row] = read(`date,amount,note,statement\n2026-01-31,5,${"x".repeat(250)},soon\n`).rows;
    expect(row.note).toHaveLength(200);
    expect(row.statement).toBeNull();
  });
  test("refuses a file with no usable header, no rows, or too many", () => {
    expect(typeof readImport([])).toBe("string");
    expect(typeof readImport(parseCsv("when,how much\n2026-01-31,5\n"))).toBe("string");
    const many = [["date", "amount"], ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => ["2026-01-31", "5"])];
    expect(typeof readImport(many)).toBe("string");
    expect(typeof readImport(many.slice(0, -1))).toBe("object");
  });
});
