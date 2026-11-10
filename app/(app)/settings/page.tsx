import { Suspense } from "react";
import type { Metadata } from "next";
import { getToday, getLedger } from "@/lib/session";
import { getSettings, listCards, listCategories } from "@/lib/data";
import { getDeletionPlan, getHousehold, listOutgoingInvites } from "@/lib/household";
import { startOf } from "@/lib/dates";
import { CardManager } from "@/components/card-manager";
import { CurrencyForm, DeleteAccount, ExportForm, ImportForm } from "@/components/settings-forms";
import { HouseholdCard } from "@/components/household-card";
import { InstallAppCard } from "@/components/install-app";
import { LegalLinks } from "@/components/legal-links";
import { UserMenu, UserMenuSkeleton } from "@/components/user-menu";
import { Card, PageHeader, Skeleton } from "@/components/ui";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <div className="flex max-w-2xl flex-col gap-6">
        <Card title="Account">
          <Suspense fallback={<UserMenuSkeleton />}>
            <UserMenu labelled />
          </Suspense>
        </Card>
        <Suspense fallback={<Skeleton className="h-32" />}>
          <CurrencyCard />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-40" />}>
          <CardsSection />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-48" />}>
          <HouseholdSection />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-32" />}>
          <ExportCard />
        </Suspense>
        <Suspense fallback={null}>
          <ImportCard />
        </Suspense>
        <InstallAppCard />
        <Suspense fallback={<Skeleton className="h-32" />}>
          <DeleteAccountCard />
        </Suspense>
        <LegalLinks />
      </div>
    </>
  );
}

async function CurrencyCard() {
  const ledger = await getLedger();
  const { currency } = await getSettings(ledger.ledgerId);
  return (
    <Card title="Currency">
      <CurrencyForm currency={currency} canEdit={ledger.role !== "viewer"} />
    </Card>
  );
}

async function CardsSection() {
  const [ledger, today] = await Promise.all([getLedger(), getToday()]);
  const [cards, { methodColors, currency }, categories] = await Promise.all([
    listCards(ledger.ledgerId, { includeArchived: true }),
    getSettings(ledger.ledgerId),
    listCategories(ledger.ledgerId),
  ]);
  return (
    <Card title="Payment methods" description="The color shows on each transaction. Purchases on a card count in the month their statement closes.">
      <CardManager today={today} cards={cards} categories={categories} methodColors={methodColors} currency={currency} canEdit={ledger.role !== "viewer"} />
    </Card>
  );
}

async function HouseholdSection() {
  const ledger = await getLedger();
  const [household, invites] = await Promise.all([
    ledger.householdId ? getHousehold(ledger.householdId) : null,
    ledger.householdId && ledger.role === "owner" ? listOutgoingInvites(ledger.householdId) : [],
  ]);
  return (
    <Card title="Household" description="Share one ledger with the people you live with.">
      <HouseholdCard household={household} invites={invites} viewerId={ledger.userId} role={ledger.role} />
    </Card>
  );
}

async function ExportCard() {
  const today = await getToday();
  return (
    <Card title="Export" description="Download your transactions as a CSV file for Excel or Google Sheets.">
      <ExportForm from={startOf(today, "year")} to={today} />
    </Card>
  );
}

/** Viewers can't add transactions, so they get no import. */
async function ImportCard() {
  const ledger = await getLedger();
  if (ledger.role === "viewer") return null;
  return (
    <Card title="Import" description="Add transactions from a CSV file, such as one exported here or from another app.">
      <ImportForm />
    </Card>
  );
}

async function DeleteAccountCard() {
  const ledger = await getLedger();
  return (
    <Card title="Delete account">
      <DeleteAccount plan={await getDeletionPlan(ledger)} />
    </Card>
  );
}
