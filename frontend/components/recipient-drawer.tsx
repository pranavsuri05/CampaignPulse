"use client";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ErrorState, Loading } from "@/components/ui/states";
import { DeliveryBadge, Notice } from "@/components/common";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { fmtDate } from "@/lib/utils";
import type { RecipientDetail } from "@/lib/types";

export function RecipientDrawer({ id, onClose }: { id: number | null; onClose: () => void }) {
  return (
    <Dialog open={id !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent side="right" title="Recipient details" description="Delivery diagnostics for this recipient">
        {id !== null && <Body id={id} />}
      </DialogContent>
    </Dialog>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-4 border-b py-2 text-[13px] last:border-0"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-medium">{v}</dd></div>;
}

function Body({ id }: { id: number }) {
  const { data: d, error, loading, reload } = useApi(() => api<RecipientDetail>(`/api/recipients/${id}`), [id]);
  if (loading && !d) return <Loading />;
  if (error) return <ErrorState message={error.message} onRetry={reload} />;
  if (!d) return null;
  return (
    <div className="space-y-5 overflow-y-auto p-5" data-testid="recipient-drawer">
      <div><p className="break-words text-lg font-semibold">{d.name}</p><p className="break-all text-sm text-muted-foreground">{d.email}</p></div>
      {d.delivery_status === "bounced" && (
        <Notice tone="danger" title={d.bounce_label ?? "Bounced"}><p>{d.bounce_reason ?? "No bounce reason was supplied by the source data."}</p></Notice>
      )}
      {d.delivery_status === "not_sent" && <Notice tone="info" title="Not sent">{d.exclusion_reason ?? "This recipient was excluded from the send."}</Notice>}
      <dl>
        <Row k="Campaign" v={d.campaign_name} />
        <Row k="Delivery status" v={<DeliveryBadge status={d.delivery_status} />} />
        <Row k="Sent" v={fmtDate(d.sent_at)} />
        <Row k="Opened" v={d.opened ? fmtDate(d.opened_at) : "No"} />
        <Row k="Clicked" v={d.clicked ? fmtDate(d.clicked_at) : "No"} />
        <Row k="Audience" v={d.audience ?? "—"} />
        <Row k="Contact status" v={<Badge tone={d.contact_status === "active" ? "success" : "warning"} className="capitalize">{d.contact_status}</Badge>} />
        <Row k="Email format" v={d.is_valid_email ? "Valid" : <Badge tone="danger">Invalid</Badge>} />
      </dl>
      {d.suppressions.length > 0 && <div><p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Suppression records</p>{d.suppressions.map((s, i) => <p key={i} className="text-[13px] capitalize">{s.kind}{s.reason ? ` — ${s.reason}` : ""}</p>)}</div>}
      <div><p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Activity</p>
        {d.events.length === 0 ? <p className="text-[13px] text-muted-foreground">No opens or clicks recorded.</p> : (
          <ul className="space-y-1.5">{d.events.map((e, i) => <li key={i} className="flex justify-between text-[13px]"><span className="capitalize">{e.type}</span><span className="text-muted-foreground">{fmtDate(e.at)}</span></li>)}</ul>)}
      </div>
      {d.other_campaigns.length > 0 && <div><p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Other campaigns</p>
        <ul className="space-y-1.5">{d.other_campaigns.map((o) => <li key={o.id} className="flex items-center justify-between text-[13px]"><span className="truncate pr-3">{o.campaign_name}</span><DeliveryBadge status={o.delivery_status} /></li>)}</ul></div>}
    </div>
  );
}
