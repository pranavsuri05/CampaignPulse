"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, BarChart3, CheckCircle2, Eye, Info, Monitor, Pencil, Play, Smartphone, Trash2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { ErrorState, Loading } from "@/components/ui/states";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CampaignStatus, Notice, PageHeader } from "@/components/common";
import { EmailFrame } from "@/components/email-frame";
import { Stepper } from "@/components/stepper";
import { ApiError, api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { cn, fmtDate, num } from "@/lib/utils";
import type { Campaign, Check, Preview, Validation } from "@/lib/types";

const SEV = {
  blocking: { label: "Blocking", tone: "danger" as const, Icon: XCircle },
  warning: { label: "Warning", tone: "warning" as const, Icon: AlertTriangle },
  information: { label: "Info", tone: "primary" as const, Icon: Info },
};

function Field({ label, value, testId }: { label: string; value: React.ReactNode; testId?: string }) {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd data-testid={testId} className="mt-0.5 break-words text-sm font-medium">{value || <span className="font-normal text-muted-foreground">Not set</span>}</dd></div>;
}

export function ReviewView({ campaignId }: { campaignId: number }) {
  const router = useRouter();
  const camp = useApi(() => api<Campaign>(`/api/campaigns/${campaignId}`), [campaignId]);
  const prev = useApi(() => api<Preview>(`/api/campaigns/${campaignId}/preview`), [campaignId]);
  const val = useApi(() => api<Validation>(`/api/campaigns/${campaignId}/validate`, { method: "POST" }), [campaignId]);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmRun, setConfirmRun] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [result, setResult] = useState<{ already_executed: boolean; kpis: { attempted: number; delivered: number; bounced: number } } | null>(null);

  const reloadAll = () => { camp.reload(); prev.reload(); val.reload(); };
  if ((camp.loading && !camp.data) || (prev.loading && !prev.data) || (val.loading && !val.data)) return <Loading />;
  const err = camp.error ?? prev.error ?? val.error;
  if (err) return <ErrorState message={err.message} onRetry={reloadAll} />;
  const c = camp.data!, p = prev.data!, v = val.data!;
  const sent = c.status === "sent", approved = c.status === "approved";
  const step = sent ? 6 : approved ? 6 : 5;

  async function act(fn: () => Promise<void>) {
    setBusy(true); setActionError(null);
    try { await fn(); } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Action failed.");
    } finally { setBusy(false); }
  }
  const approve = () => act(async () => { await api(`/api/campaigns/${c.id}/approve`, { method: "POST", json: { acknowledge_warnings: ack } }); reloadAll(); });
  const run = () => act(async () => {
    const r = await api<NonNullable<typeof result>>(`/api/campaigns/${c.id}/execute`, { method: "POST" });
    setResult(r); setConfirmRun(false); reloadAll();
  });
  const del = () => act(async () => { await api(`/api/campaigns/${c.id}`, { method: "DELETE" }); router.push("/review"); });

  const grouped = (["blocking", "warning", "information"] as const).map((s) => ({ s, items: v.checks.filter((k) => k.severity === s && k.status === "fail") }));
  const passed = v.checks.filter((k) => k.status === "pass");
  const warnCount = v.warning_count;
  const canApprove = v.can_approve && (!v.requires_acknowledgement || ack);

  return (
    <div>
      <PageHeader title={c.name} description={`${c.campaign_type.replace("_", " ")} campaign`}
        actions={<>
          <CampaignStatus status={c.status} />
          {!sent && <Button variant="outline" size="sm" asChild><Link href={`/campaigns/${c.id}/edit`}><Pencil />Edit campaign</Link></Button>}
          <Button variant="outline" size="sm" onClick={() => setConfirmDelete(true)}><Trash2 />Delete</Button>
        </>} />
      <Stepper current={step} />
      <div className="mb-5 flex items-center gap-2 rounded-md border bg-card px-4 py-2.5 text-[13px] text-muted-foreground" data-testid="readonly-banner">
        <Eye className="size-4 text-primary" /><span><strong className="text-foreground">Read-only review.</strong> Viewing this page never modifies the campaign. Use <em>Edit campaign</em> to make changes.</span>
      </div>

      {sent && (
        <div className="mb-5"><Notice tone="success" title={result?.already_executed ? "Already executed — nothing was sent twice" : "Executed in Simulation Mode"}>
          <p>{c.executed_at ? `Simulated on ${fmtDate(c.executed_at)}. ` : ""}Delivery records were generated; no real emails were sent.</p>
          <Button size="sm" className="mt-2" asChild><Link href={`/analytics?campaign=${c.id}`}><BarChart3 />View analytics</Link></Button></Notice></div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Email preview" description={p.sample_recipient ? `Personalised for sample recipient: ${p.sample_recipient.name}` : "No eligible recipient — showing placeholder values"} />
            <CardBody>
              <Tabs defaultValue="desktop">
                <TabsList aria-label="Preview device"><TabsTrigger value="desktop"><Monitor className="size-3.5" />Desktop</TabsTrigger><TabsTrigger value="mobile"><Smartphone className="size-3.5" />Mobile</TabsTrigger></TabsList>
                <div className="mt-3 rounded-md border">
                  <div className="space-y-0.5 border-b bg-muted/40 px-4 py-3 text-[13px]">
                    <p><span className="text-muted-foreground">From: </span><span data-testid="inbox-from">{p.sender.name} &lt;{p.sender.email}&gt;</span></p>
                    <p><span className="text-muted-foreground">Subject: </span><strong data-testid="inbox-subject">{p.subject || "(no subject)"}</strong></p>
                    <p className="text-muted-foreground">{p.preview_text}</p>
                  </div>
                  <TabsContent value="desktop" className="m-0"><EmailFrame html={p.html} mode="desktop" className="rounded-none" /></TabsContent>
                  <TabsContent value="mobile" className="m-0"><EmailFrame html={p.html} mode="mobile" className="rounded-none" /></TabsContent>
                </div>
              </Tabs>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Pre-send checklist" description={`${passed.length} of ${v.checks.length} checks passed`}
              action={<div className="text-right" title={v.score_rules}><p className="tabular text-2xl font-semibold" data-testid="readiness-score">{v.readiness_score}</p><p className="text-[11px] text-muted-foreground">readiness score</p></div>} />
            <CardBody className="space-y-5">
              {grouped.map(({ s, items }) => items.length > 0 && (
                <div key={s}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{SEV[s].label} ({items.length})</p>
                  <ul className="space-y-2">{items.map((k) => <CheckRow key={k.id} k={k} />)}</ul>
                </div>
              ))}
              {passed.length > 0 && (
                <details className="group">
                  <summary className="cursor-pointer text-[13px] font-medium text-muted-foreground">Passed checks ({passed.length})</summary>
                  <ul className="mt-2 space-y-1.5">{passed.map((k) => <li key={k.id} className="flex items-center gap-2 text-[13px]"><CheckCircle2 className="size-4 text-success" />{k.label}<span className="text-muted-foreground">· {k.message}</span></li>)}</ul>
                </details>
              )}
              <p className="border-t pt-3 text-xs text-muted-foreground">Score rules: {v.score_rules}</p>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Sender & email" />
            <CardBody><dl className="space-y-3">
              <Field label="Sender name" value={p.sender.name} testId="review-sender-name" />
              <Field label="Sender email" value={p.sender.email} testId="review-sender-email" />
              <Field label="Subject line" value={p.subject} testId="review-subject" />
              <Field label="Preview text" value={p.preview_text} testId="review-preview-text" />
            </dl></CardBody>
          </Card>
          <Card>
            <CardHeader title="Audience" description={p.audience.name ?? "No audience selected"} />
            <CardBody><dl className="grid grid-cols-2 gap-3" data-testid="audience-counts">
              {([["Total recipients", p.audience.total, "total"], ["Eligible", p.audience.eligible, "eligible"], ["Invalid", p.audience.invalid, "invalid"], ["Duplicate", p.audience.duplicate, "duplicate"], ["Suppressed", p.audience.suppressed, "suppressed"], ["Unsubscribed", p.audience.unsubscribed, "unsubscribed"]] as const).map(([l, n, k]) => (
                <div key={k} className="rounded-md border p-2.5"><dt className="text-xs text-muted-foreground">{l}</dt><dd data-testid={`aud-${k}`} className={cn("tabular text-lg font-semibold", k === "eligible" && "text-success")}>{num(n)}</dd></div>
              ))}
            </dl><p className="mt-3 text-xs text-muted-foreground">Invalid, duplicate, suppressed and unsubscribed recipients are excluded automatically.</p></CardBody>
          </Card>

          <Card>
            <CardHeader title="Approval & execution" description="Step 7" />
            <CardBody className="space-y-3">
              {sent ? <p className="text-sm text-muted-foreground">This campaign has been executed. Re-running is blocked, so recipients can never be sent to twice.</p> : (
                <>
                  {!v.can_approve && <Notice tone="danger" title="Blocking issues">Fix the {v.blocking_count} blocking issue(s) before approving. Use <em>Edit campaign</em>.</Notice>}
                  {v.can_approve && v.requires_acknowledgement && !approved && (
                    <label className="flex cursor-pointer items-start gap-2 rounded-md border border-warning/30 bg-warning-soft p-3 text-[13px]">
                      <Checkbox checked={ack} onCheckedChange={(x) => setAck(x === true)} aria-label="Acknowledge warnings" className="mt-0.5" />
                      <span>I have reviewed the {warnCount} warning(s) and want to continue.</span>
                    </label>
                  )}
                  {!approved && <Button className="w-full" disabled={!canApprove || busy} onClick={approve}><CheckCircle2 />Approve campaign</Button>}
                  {approved && (<>
                    <Notice tone="success">Approved {fmtDate(c.approved_at)}. Ready to run.</Notice>
                    <Button className="w-full" disabled={busy} onClick={() => setConfirmRun(true)}><Play />Execute in Simulation Mode</Button>
                  </>)}
                </>
              )}
              {actionError && <Notice tone="danger">{actionError}</Notice>}
              <p className="text-xs text-muted-foreground">Simulation Mode — No real emails are being sent.</p>
            </CardBody>
          </Card>
        </div>
      </div>

      <Dialog open={confirmRun} onOpenChange={setConfirmRun}>
        <DialogContent title="Execute in Simulation Mode?" description="Delivery records and outcomes will be generated for eligible recipients. No real emails are sent.">
          <div className="space-y-2 px-5 py-4 text-sm"><p><strong>{num(p.audience.eligible)}</strong> eligible recipients will be processed.</p><p className="text-muted-foreground">This can only run once per campaign.</p></div>
          <div className="flex justify-end gap-2 border-t px-5 py-3"><DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose><Button onClick={run} disabled={busy}>Run simulation</Button></div>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent title="Delete this campaign?" description="The campaign and its delivery records are permanently removed. This cannot be undone.">
          <div className="flex justify-end gap-2 px-5 py-4"><DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose><Button variant="danger" onClick={del} disabled={busy}>Delete campaign</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CheckRow({ k }: { k: Check }) {
  const { Icon, tone, label } = SEV[k.severity];
  return (
    <li data-testid={`check-${k.id}`} data-severity={k.severity} className="flex gap-3 rounded-md border p-3">
      <Icon className={cn("mt-0.5 size-4 shrink-0", { danger: "text-danger", warning: "text-warning", primary: "text-primary" }[tone])} />
      <div className="min-w-0 text-[13px]">
        <p className="flex flex-wrap items-center gap-2 font-medium">{k.label}<Badge tone={tone}>{label}</Badge></p>
        <p className="mt-0.5">{k.message}</p>
        {k.suggestion && <p className="mt-0.5 text-muted-foreground">Suggestion: {k.suggestion}</p>}
      </div>
    </li>
  );
}
