"use client";

import { ErrorState } from "@/components/error-state";

/** For the pages outside the app layout (sign-in, privacy, terms). */
export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="flex min-h-dvh items-center px-4 py-8">
      <ErrorState error={error} retry={retry} />
    </main>
  );
}
