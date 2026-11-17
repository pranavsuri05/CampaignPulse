"use client";
import { cn } from "@/lib/utils";

/** Renders server-sanitised email HTML inside a fully sandboxed iframe (no scripts, no same-origin). */
export function EmailFrame({ html, mode = "desktop", title = "Email preview", className }: { html: string; mode?: "desktop" | "mobile"; title?: string; className?: string }) {
  return (
    <div className={cn("flex justify-center rounded-md bg-muted/70 p-4", className)}>
      <iframe
        title={title}
        data-testid="email-frame"
        data-mode={mode}
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={html}
        className={cn("h-[520px] rounded-md border bg-white shadow-card transition-[width]", mode === "mobile" ? "w-[375px] max-w-full" : "w-full")}
      />
    </div>
  );
}
