import type { ReactNode } from "react";
import { Banknote, CircleEllipsis, CreditCard, Smartphone, Wallet, type LucideIcon } from "lucide-react";
import { methodColor, methodLabel, onMethodColor, type Method, type MethodColor, type MethodColors } from "@/lib/statements";

const METHOD_ICONS: Record<Method, LucideIcon> = { card: CreditCard, cash: Banknote, gcash: Smartphone, maya: Wallet, others: CircleEllipsis };

const SIZES = {
  sm: { box: "size-6 rounded-md", icon: "size-4" },
  md: { box: "size-10 rounded-xl", icon: "size-5" },
};

/** A payment method's icon on its solid color. */
export function MethodIcon({ method, color, size = "sm" }: { method: Method; color: MethodColor; size?: keyof typeof SIZES }) {
  const Icon = METHOD_ICONS[method];
  return (
    <span
      className={`flex shrink-0 items-center justify-center ${SIZES[size].box}`}
      style={{ backgroundColor: color, color: onMethodColor(color) }}
    >
      <Icon className={SIZES[size].icon} aria-hidden />
    </span>
  );
}

/** A payment method's name on its solid color, with `children` after it. Renders nothing when no method is set. */
export function MethodTag({ method, card, colors, children }: {
  method: Method | null;
  card: { name: string; last4: string; color: MethodColor } | undefined;
  colors: MethodColors;
  children?: ReactNode;
}) {
  if (!method) return null;
  const color = methodColor(method, card, colors);
  return (
    <span className="max-w-full rounded px-1.5 py-0.5 text-xs font-medium break-words" style={{ backgroundColor: color, color: onMethodColor(color) }}>
      {method === "card" && <CreditCard className="mr-1 inline size-3 align-[-0.125em]" aria-hidden />}
      {methodLabel(method, card)}
      {children}
    </span>
  );
}
