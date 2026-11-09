import { Suspense } from "react";
import type { Metadata } from "next";
import { getLedger, getToday } from "@/lib/session";
import { categoryStats, getSettings, listCards, listCategories } from "@/lib/data";
import { endOf, startOf } from "@/lib/dates";
import { CategoryManager } from "@/components/category-manager";
import { PageHeader, Skeleton } from "@/components/ui";

export const metadata: Metadata = { title: "Categories" };

export default function CategoriesPage() {
  return (
    <>
      <PageHeader
        title="Categories"
        description="Built-in categories are shared by everyone. Add your own, or add subcategories to any category."
      />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Categories />
      </Suspense>
    </>
  );
}

async function Categories() {
  const [ledger, today] = await Promise.all([getLedger(), getToday()]);
  const month = startOf(today, "month");
  const monthEnd = endOf(month, "month");
  const [categories, cards, { currency, methodColors }, stats] = await Promise.all([
    listCategories(ledger.ledgerId),
    listCards(ledger.ledgerId, { includeArchived: true }),
    getSettings(ledger.ledgerId),
    categoryStats(ledger.ledgerId, month, monthEnd),
  ]);
  return (
    <CategoryManager
      categories={categories}
      cards={cards}
      methodColors={methodColors}
      currency={currency}
      canEdit={ledger.role !== "viewer"}
      stats={stats}
      month={month}
      monthEnd={monthEnd}
      today={today}
    />
  );
}
