import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { STEPS } from "@/lib/schemas";

export function Stepper({ current, onSelect, maxReached }: { current: number; onSelect?: (i: number) => void; maxReached?: number }) {
  return (
    <ol aria-label="Campaign steps" className="mb-6 flex flex-wrap gap-x-1 gap-y-2">
      {STEPS.map((s, i) => {
        const done = i < current;
        const clickable = onSelect && i < 5 && i <= (maxReached ?? current);
        const inner = (
          <>
            <span className={cn("flex size-5 items-center justify-center rounded-full border text-[11px] font-semibold", done && "border-primary bg-primary text-white", i === current && "border-primary text-primary")}>
              {done ? <Check className="size-3" strokeWidth={3} /> : i + 1}
            </span>
            <span className={cn("text-[13px]", i === current ? "font-medium" : "text-muted-foreground")}>{s.label}</span>
          </>
        );
        return (
          <li key={s.key} aria-current={i === current ? "step" : undefined} className="flex items-center">
            {clickable ? (
              <button type="button" onClick={() => onSelect(i)} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted">{inner}</button>
            ) : <span className="flex items-center gap-2 px-2 py-1">{inner}</span>}
            {i < STEPS.length - 1 && <span className="mx-1 h-px w-4 bg-border" />}
          </li>
        );
      })}
    </ol>
  );
}
