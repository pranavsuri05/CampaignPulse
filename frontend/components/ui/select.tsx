"use client";
import * as React from "react";
import * as S from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type Option = { value: string; label: string };

export function Select({ value, onValueChange, options, placeholder, className, id, "aria-label": aria }: {
  value: string; onValueChange: (v: string) => void; options: Option[]; placeholder?: string; className?: string; id?: string; "aria-label"?: string;
}) {
  return (
    <S.Root value={value} onValueChange={onValueChange}>
      <S.Trigger id={id} aria-label={aria} className={cn("flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-card px-3 text-sm data-[placeholder]:text-muted-foreground", className)}>
        <span className="truncate"><S.Value placeholder={placeholder} /></span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </S.Trigger>
      <S.Portal>
        <S.Content position="popper" sideOffset={4} className="z-[60] max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border bg-card shadow-pop">
          <S.Viewport className="p-1">
            {options.map((o) => (
              <S.Item key={o.value} value={o.value} className="relative flex cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-3 text-sm outline-none data-[highlighted]:bg-muted">
                <S.ItemIndicator className="absolute left-2"><Check className="size-4 text-primary" /></S.ItemIndicator>
                <S.ItemText>{o.label}</S.ItemText>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}
