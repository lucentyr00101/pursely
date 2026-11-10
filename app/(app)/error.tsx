"use client";

import { ErrorState } from "@/components/error-state";

/** Shown inside the app layout, so the navigation stays usable when a page fails. */
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorState error={error} retry={retry} className="mt-10" />;
}
