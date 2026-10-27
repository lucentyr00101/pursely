"use client";

import { useSyncExternalStore } from "react";
import { Download, Share, SquarePlus } from "lucide-react";
import { Card } from "./ui";

type InstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type Platform = "installed" | "ios" | "other";

// Chrome fires beforeinstallprompt once, often before the settings page mounts,
// so the listener lives at module level and the app layout loads this module.
let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    notify();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getPlatform(): Platform {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (installed || standalone) return "installed";
  // iPadOS reports itself as a Mac, so check for touch too.
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios ? "ios" : "other";
}

/** Mounted in the app layout so beforeinstallprompt is caught on any page. */
export function InstallPromptListener() {
  return null;
}

export function InstallAppCard() {
  const prompt = useSyncExternalStore(subscribe, () => deferred, () => null);
  const platform = useSyncExternalStore(subscribe, getPlatform, () => null);

  if (platform === null || platform === "installed") return null;

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    // The event can only be used once, whatever the user chose.
    deferred = null;
    notify();
  }

  return (
    <Card title="Install app" description="Add Pursely to your home screen to open it like an app, full screen.">
      {prompt ? (
        <button type="button" onClick={install} className="btn btn-primary">
          <Download className="size-4" aria-hidden />
          Install Pursely
        </button>
      ) : platform === "ios" ? (
        <ol className="flex flex-col gap-2 text-sm">
          <li className="flex items-center gap-2">
            1. In Safari, tap <Share className="size-4 shrink-0" aria-label="Share" />
          </li>
          <li className="flex items-center gap-2">
            2. Choose <SquarePlus className="size-4 shrink-0" aria-hidden /> <strong>Add to Home Screen</strong>
          </li>
        </ol>
      ) : (
        <p className="text-sm text-muted">
          Open your browser menu and choose <strong>Install app</strong> or <strong>Add to home screen</strong>.
        </p>
      )}
    </Card>
  );
}
