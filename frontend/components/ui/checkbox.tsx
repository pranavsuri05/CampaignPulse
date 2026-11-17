"use client";
import * as C from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function Checkbox({ className, ...p }: React.ComponentPropsWithoutRef<typeof C.Root>) {
  return (
    <C.Root className={cn("flex size-4 shrink-0 items-center justify-center rounded-[4px] border bg-card data-[state=checked]:border-primary data-[state=checked]:bg-primary", className)} {...p}>
      <C.Indicator><Check className="size-3 text-white" strokeWidth={3} /></C.Indicator>
    </C.Root>
  );
}
