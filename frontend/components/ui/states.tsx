import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "./button";

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <div role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{label}</div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 py-14 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-danger-soft text-danger"><AlertCircle className="size-5" /></div>
      <div><p className="font-medium">Something went wrong</p><p className="mt-0.5 max-w-sm text-[13px] text-muted-foreground">{message}</p></div>
      {onRetry && <Button variant="outline" size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon: React.ReactNode; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-primary-soft text-primary [&_svg]:size-5">{icon}</div>
      <div><p className="font-medium">{title}</p><p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">{description}</p></div>
      {action}
    </div>
  );
}
