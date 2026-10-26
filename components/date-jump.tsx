"use client";

import { useRouter } from "next/navigation";
import { isIsoDate } from "@/lib/dates";
import { DatePicker } from "./date-picker";

export function DateJump({ value, max }: { value: string; max: string }) {
  const router = useRouter();
  return (
    <DatePicker
      aria-label="Go to date"
      value={value}
      max={max}
      onChange={(date) => isIsoDate(date) && router.push(`/transactions?date=${date}`)}
      required
      className="flex-1 sm:flex-none"
    />
  );
}
