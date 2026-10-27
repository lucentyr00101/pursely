import { Suspense } from "react";
import type { Metadata } from "next";
import { getToday, getLedger } from "@/lib/session";
import { getSettings } from "@/lib/data";
import { getHousehold, listOutgoingInvites } from "@/lib/household";
import { startOf } from "@/lib/dates";
import { CurrencyForm, ExportForm } from "@/components/settings-forms";
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
        <Suspense fallback={<Skeleton className="h-48" />}>
          <HouseholdSection />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-32" />}>
          <ExportCard />
        </Suspense>
        <InstallAppCard />
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
