import Link from "next/link";
import type { Metadata } from "next";
import { Compass } from "lucide-react";
import { Logo } from "@/components/logo";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 py-8 sm:px-6">
      <Logo />
      <div className="flex flex-1 items-center">
        <div className="glass mx-auto flex max-w-md flex-col items-center rounded-2xl p-6 text-center">
          <Compass className="size-8 text-accent" aria-hidden />
          <h1 className="mt-3 text-lg font-semibold">Page not found</h1>
          <p className="mt-1 text-sm text-muted text-pretty">That link doesn&apos;t lead anywhere. It may have been moved or mistyped.</p>
          {/* The proxy sends a signed-in visitor on from here to the dashboard. */}
          <Link href="/" className="btn btn-primary mt-5">
            Go to Pursely
          </Link>
        </div>
      </div>
    </main>
  );
}
