// Budget history math, kept apart from the database so it can be tested.

/** One entry of a category's budget history. `from` is its first month (YYYY-MM-01); null or missing means every month. */
export type BudgetEntry = { categoryId: string; from?: string | null; amount: number | null };

/**
 * Each category's budget for `month` (YYYY-MM-01): its latest entry starting on or before it. A
 * category whose latest entry has a null amount has no budget, so it is left out.
 */
export function budgetsFor(entries: BudgetEntry[], month: string): Map<string, number> {
  const latest = new Map<string, BudgetEntry>();
  for (const b of entries) {
    const from = b.from ?? "";
    if (from > month) continue;
    const seen = latest.get(b.categoryId);
    if (!seen || from > (seen.from ?? "")) latest.set(b.categoryId, b);
  }
  return new Map([...latest].flatMap(([id, b]) => (b.amount === null ? [] : [[id, b.amount] as const])));
}
