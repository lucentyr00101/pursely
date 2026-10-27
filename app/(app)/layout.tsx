import { Suspense } from "react";
import { InstallPromptListener } from "@/components/install-app";
import { InviteBanner } from "@/components/invite-banner";
import { Logo } from "@/components/logo";
import { BottomNav, LogoLink, SideNav } from "@/components/nav";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { ViewOnlyBadge } from "@/components/view-only-badge";
import { UserMenu, UserMenuSkeleton } from "@/components/user-menu";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="lg:grid lg:min-h-dvh lg:grid-cols-[16rem_1fr]">
      <aside className="glass sticky top-0 hidden h-dvh flex-col gap-8 border-y-0 border-l-0 p-4 lg:flex">
        <LogoLink />
        <SideNav />
        <div className="mt-auto flex flex-col gap-3">
          <Suspense fallback={null}>
            <ViewOnlyBadge />
          </Suspense>
          <Suspense fallback={<UserMenuSkeleton />}>
            <UserMenu />
          </Suspense>
        </div>
      </aside>

      {/* Phones in landscape have ~390px of height, too little to pin a header above the bottom nav. */}
      <header className="glass sticky top-0 z-30 flex h-16 [@media(max-height:500px)]:static items-center justify-between border-x-0 border-t-0 px-4 lg:hidden">
        <Logo />
        <Suspense fallback={null}>
          <ViewOnlyBadge />
        </Suspense>
      </header>

      {/* Bottom padding clears the bottom nav and the floating add button below lg. */}
      <main className="mx-auto w-full max-w-6xl px-4 pt-6 pb-40 sm:px-6 lg:pb-12">
        <Suspense fallback={null}>
          <InviteBanner />
        </Suspense>
        {children}
      </main>
      <BottomNav />
      <PullToRefresh />
      <InstallPromptListener />
    </div>
  );
}
