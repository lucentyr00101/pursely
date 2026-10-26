import {
  Baby, BookOpen, Briefcase, Bus, Car, CircleEllipsis, Clapperboard, Coffee, Dumbbell, Fuel, Gamepad2, Gift,
  GraduationCap, HandCoins, HeartPulse, House, Landmark, Banknote, Laptop, Music, PawPrint, PiggyBank, Plane,
  Receipt, Shield, Shirt, ShoppingBag, Smartphone, Sparkles, Store, Tag, TrendingUp, Utensils, Wallet, Wrench, Zap,
  type LucideIcon,
} from "lucide-react";
import type { IconKey } from "@/lib/category-defs";

export const ICONS: Record<IconKey, LucideIcon> = {
  utensils: Utensils, coffee: Coffee, car: Car, bus: Bus, fuel: Fuel, house: House, zap: Zap,
  smartphone: Smartphone, "shopping-bag": ShoppingBag, shirt: Shirt, "heart-pulse": HeartPulse,
  dumbbell: Dumbbell, clapperboard: Clapperboard, music: Music, gamepad: Gamepad2,
  "graduation-cap": GraduationCap, book: BookOpen, receipt: Receipt, shield: Shield, plane: Plane,
  sparkles: Sparkles, gift: Gift, "paw-print": PawPrint, baby: Baby, wrench: Wrench, briefcase: Briefcase,
  laptop: Laptop, store: Store, "trending-up": TrendingUp, "hand-coins": HandCoins, "piggy-bank": PiggyBank,
  wallet: Wallet, landmark: Landmark, banknote: Banknote, tag: Tag, more: CircleEllipsis,
};

export function CategoryIcon({ icon, color, size = "md" }: { icon: IconKey; color: string; size?: "xs" | "sm" | "md" }) {
  const Icon = ICONS[icon] ?? Tag;
  const box = size === "xs" ? "size-6 rounded-md" : size === "sm" ? "size-8 rounded-md" : "size-10 rounded-lg";
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center ${box}`}
      style={{ backgroundColor: `${color}26`, color }}
    >
      <Icon className={size === "md" ? "size-5" : size === "sm" ? "size-4" : "size-3.5"} strokeWidth={2} />
    </span>
  );
}
