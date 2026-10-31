import { Banknote, CircleEllipsis, CreditCard, Smartphone, Wallet, type LucideIcon } from "lucide-react";
import { onMethodColor, type Method, type MethodColor } from "@/lib/statements";

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
