"use client";

import { ErrorState } from "@/components/error-state";
import "./globals.css";

/** Replaces the root layout when it fails itself, so it brings its own document and styles. */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full font-sans">
        <title>Something went wrong · Pursely</title>
        <main className="flex min-h-dvh items-center px-4 py-8">
          <ErrorState error={error} retry={retry} />
        </main>
      </body>
    </html>
  );
}
