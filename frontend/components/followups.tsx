"use client";
import { useState } from "react";
import { Download, Lightbulb, Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ErrorState, Loading } from "@/components/ui/states";
import { Notice } from "@/components/common";
import { EmailFrame } from "@/components/email-frame";
import { API_BASE, ApiError, api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";
import type { FollowupSegment, Template } from "@/lib/types";

export function Followups({ campaignId }: { campaignId: number }) {
  const segs = useApi(() => api<{ segments: FollowupSegment[] }>(`/api/campaigns/${campaignId}/followups`), [campaignId]);
  const [key, setKey] = useState("bounced");
  const [draft, setDraft] = useState<Template | null>(null);
  const [html, setHtml] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (segs.loading && !segs.data) return <Loading />;
  if (segs.error) return <ErrorState message={segs.error.message} onRetry={segs.reload} />;
  const seg = segs.data!.segments.find((s) => s.key === key)!;

  async function refreshPreview(t: Template) {
    const p = await api<{ html: string }>(`/api/templates/${t.id}/preview`);
    setHtml(p.html);
  }
  async function createDraft() {
    setErr(null); setMsg(null);
    try {
      const t = await api<Template>(`/api/campaigns/${campaignId}/followups/draft`, { method: "POST", json: { segment: key } });
      setDraft(t); await refreshPreview(t);
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Could not create draft"); }
  }
  async function saveDraft() {
    if (!draft) return;
    setErr(null);
    try {
      const t = await api<Template>(`/api/templates/${draft.id}`, { method: "PATCH", json: { subject: draft.subject, body_html: draft.body_html } });
      setDraft(t); await refreshPreview(t); setMsg("Draft saved. Nothing has been sent.");
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Could not save draft"); }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-3">
        {segs.data!.segments.map((s) => (
          <button key={s.key} type="button" onClick={() => { setKey(s.key); setDraft(null); setMsg(null); }} aria-pressed={key === s.key} data-testid={`segment-${s.key}`}
            className={cn("rounded-lg border bg-card p-4 text-left shadow-card transition-colors hover:bg-muted/40", key === s.key && "border-primary ring-1 ring-primary")}>
            <p className="text-sm font-medium">{s.label}</p>
            <p className="tabular mt-1 text-2xl font-semibold">{s.total}</p>
            <p className="text-xs text-muted-foreground">{s.eligible} eligible · {s.excluded} excluded</p>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader title={seg.label} description={seg.description}
          action={<div className="flex gap-2">
            <Button variant="outline" size="sm" asChild><a data-testid="export-segment" href={`${API_BASE}/api/campaigns/${campaignId}/followups/export?segment=${key}`} download><Download />Export eligible CSV</a></Button>
            <Button size="sm" onClick={createDraft} disabled={seg.eligible === 0}><Mail />Create follow-up draft</Button>
          </div>} />
        {seg.total === 0 ? <p className="p-6 text-sm text-muted-foreground">No recipients in this segment.</p> : (
          <Table data-testid="segment-table"><THead><TR><TH>Recipient</TH><TH>Email</TH><TH>Follow-up</TH><TH>Reason</TH></TR></THead>
            <TBody>{seg.members.map((m) => (
              <TR key={m.id}><TD className="font-medium">{m.name}</TD><TD>{m.email}</TD>
                <TD><Badge tone={m.included ? "success" : "neutral"}>{m.included ? "Included" : "Excluded"}</Badge></TD>
                <TD className="text-[13px] text-muted-foreground">{m.reason}</TD></TR>))}</TBody></Table>
        )}
        {seg.total > seg.members.length && <p className="border-t px-4 py-2 text-xs text-muted-foreground">Showing first {seg.members.length} of {seg.total}. The CSV export includes every eligible recipient.</p>}
      </Card>

      {key === "unopened" && <Notice tone="info"><span className="flex items-center gap-2"><Lightbulb className="size-4" />&ldquo;Unopened&rdquo; is based on tracking pixels, which privacy proxies can block or inflate.</span></Notice>}
      {err && <Notice tone="danger">{err}</Notice>}

      {draft && (
        <Card>
          <CardHeader title="Follow-up draft" description="Edit and preview. Campaign Pulse never sends follow-ups automatically." />
          <CardBody className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-3">
              <div><Label htmlFor="fu-subject">Subject</Label><Input id="fu-subject" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></div>
              <div><Label htmlFor="fu-body">Body (HTML)</Label><Textarea id="fu-body" rows={12} className="font-mono text-xs" value={draft.body_html} onChange={(e) => setDraft({ ...draft, body_html: e.target.value })} /></div>
              <div className="flex items-center gap-3"><Button size="sm" onClick={saveDraft}>Save & refresh preview</Button>{msg && <span role="status" className="text-[13px] text-success">{msg}</span>}</div>
            </div>
            <EmailFrame html={html} title="Follow-up preview" />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
