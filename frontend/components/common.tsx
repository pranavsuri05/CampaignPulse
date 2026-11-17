import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Health } from "@/lib/types";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div><h1>{title}</h1>{description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}</div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Kpi({ label, value, sub, hint }: { label: string; value: string; sub?: string; hint?: string }) {
  return (
    <Card className="p-4" title={hint}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="tabular mt-1.5 text-2xl font-semibold tracking-tight">{value}</p>
      {sub && <p className="tabular mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
}

const STATUS_TONE = { draft: "neutral", approved: "primary", sent: "success" } as const;
export function CampaignStatus({ status }: { status: "draft" | "approved" | "sent" | string }) {
  return <Badge tone={STATUS_TONE[status as keyof typeof STATUS_TONE] ?? "neutral"} className="capitalize">{status}</Badge>;
}

export function HealthBadge({ health }: { health?: Health }) {
  if (!health) return null;
  const tone = { good: "success", warn: "warning", bad: "danger", neutral: "neutral" }[health.level] as "success" | "warning" | "danger" | "neutral";
  return <Badge tone={tone}>{health.label}</Badge>;
}

export function DeliveryBadge({ status }: { status: string }) {
  const m: Record<string, ["success" | "danger" | "neutral", string]> = { delivered: ["success", "Delivered"], bounced: ["danger", "Bounced"], not_sent: ["neutral", "Not sent"] };
  const [tone, label] = m[status] ?? ["neutral", status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function Notice({ tone, title, children }: { tone: "info" | "warning" | "danger" | "success"; title?: string; children: React.ReactNode }) {
  const cls = { info: "border-primary/20 bg-primary-soft", warning: "border-warning/30 bg-warning-soft", danger: "border-danger/30 bg-danger-soft", success: "border-success/30 bg-success-soft" }[tone];
  return <div className={cn("rounded-md border px-4 py-3 text-sm", cls)}>{title && <p className="font-medium">{title}</p>}<div className={title ? "mt-0.5 text-[13px]" : ""}>{children}</div></div>;
}
