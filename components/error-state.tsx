"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";

/** The fallback an error boundary shows: what happened in plain words, and a way to try again. */
export function ErrorState({ error, retry, className = "" }: { error: unknown; retry: () => void; className?: string }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  // Server errors arrive with a digest that matches the server log; the message itself is withheld.
  const digest = error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : null;

  return (
    <div role="alert" className={`glass mx-auto flex max-w-md flex-col items-center rounded-2xl p-6 text-center ${className}`}>
      <TriangleAlert className="size-8 text-danger" aria-hidden />
      <h1 className="mt-3 text-lg font-semibold">Something went wrong</h1>
      <p className="mt-1 text-sm text-muted text-pretty">
        This page couldn&apos;t load. Your data is safe. Check your connection and try again.
      </p>
      <button type="button" onClick={() => retry()} className="btn btn-primary mt-5">
        Try again
      </button>
      {digest && <p className="mt-4 text-xs text-subtle">Error code {digest}</p>}
    </div>
  );
}
