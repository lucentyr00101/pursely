import { describe, expect, test } from "bun:test";
import { budgetsFor } from "./budgets";

const food = "food";
const rent = "rent";

describe("budgetsFor", () => {
  test("an entry applies from its month until a later one takes over", () => {
    const entries = [
      { categoryId: food, from: "2026-03-01", amount: 500_00 },
      { categoryId: food, from: "2026-06-01", amount: 800_00 },
    ];
    expect(budgetsFor(entries, "2026-02-01").get(food)).toBeUndefined();
    expect(budgetsFor(entries, "2026-03-01").get(food)).toBe(500_00);
    expect(budgetsFor(entries, "2026-05-01").get(food)).toBe(500_00);
    expect(budgetsFor(entries, "2026-06-01").get(food)).toBe(800_00);
    expect(budgetsFor(entries, "2027-01-01").get(food)).toBe(800_00);
  });
  test("the order of entries doesn't matter", () => {
    const entries = [
      { categoryId: food, from: "2026-06-01", amount: 800_00 },
      { categoryId: food, from: "2026-03-01", amount: 500_00 },
    ];
    expect(budgetsFor(entries, "2026-04-01").get(food)).toBe(500_00);
    expect(budgetsFor(entries, "2026-07-01").get(food)).toBe(800_00);
  });
  test("an entry with no month applies to every month, until a dated one", () => {
    const entries = [
      { categoryId: food, amount: 300_00 },
      { categoryId: rent, from: null, amount: 900_00 },
      { categoryId: food, from: "2026-06-01", amount: 800_00 },
    ];
    expect(budgetsFor(entries, "2020-01-01").get(food)).toBe(300_00);
    expect(budgetsFor(entries, "2026-06-01").get(food)).toBe(800_00);
    expect(budgetsFor(entries, "2026-06-01").get(rent)).toBe(900_00);
  });
  test("a null amount ends the budget from its month on", () => {
    const entries = [
      { categoryId: food, from: "2026-03-01", amount: 500_00 },
      { categoryId: food, from: "2026-06-01", amount: null },
    ];
    expect(budgetsFor(entries, "2026-05-01").get(food)).toBe(500_00);
    expect(budgetsFor(entries, "2026-06-01").has(food)).toBe(false);
    expect(budgetsFor(entries, "2026-09-01").has(food)).toBe(false);
  });
  test("a budget set again after it ended comes back", () => {
    const entries = [
      { categoryId: food, from: "2026-03-01", amount: 500_00 },
      { categoryId: food, from: "2026-06-01", amount: null },
      { categoryId: food, from: "2026-08-01", amount: 400_00 },
    ];
    expect(budgetsFor(entries, "2026-07-01").has(food)).toBe(false);
    expect(budgetsFor(entries, "2026-08-01").get(food)).toBe(400_00);
  });
  test("categories are resolved separately", () => {
    const entries = [
      { categoryId: food, from: "2026-03-01", amount: 500_00 },
      { categoryId: rent, from: "2026-05-01", amount: 900_00 },
    ];
    expect([...budgetsFor(entries, "2026-04-01")]).toEqual([[food, 500_00]]);
    expect(budgetsFor(entries, "2026-05-01").size).toBe(2);
  });
});
