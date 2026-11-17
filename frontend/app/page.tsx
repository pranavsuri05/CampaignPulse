"use client";
import Link from "next/link";
import { useState } from "react";
import { BarChart3, ClipboardCheck, Database, FilePlus2, Lightbulb, Plus, Upload, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ErrorState, Loading } from "@/components/ui/states";
import { CampaignStatus, HealthBadge, Kpi, Notice, PageHeader } from "@/components/common";
import { ImportDialog, type ImportKind } from "@/components/import-dialog";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { fmtDate, num, pct } from "@/lib/utils";
import type { Campaign, Overview } from "@/lib/types";

export default function OverviewPage() {
  const ov = useApi(() => api<Overview>("/api/overview"), []);
  const cs = useApi(() => api<{ items: Campaign[] }>("/api/campaigns"), []);
  const [imp, setImp] = useState<ImportKind | null>(null);
  const reload = () => { ov.reload(); cs.reload(); };

  if (ov.loading && !ov.data) return <Loading />;
  if (ov.error) return <ErrorState message={ov.error.message} onRetry={reload} />;
  const o = ov.data!;
  const items = cs.data?.items ?? [];
  const empty = o.contacts === 0 && items.length === 0;

  const dialogs = (
    <>
      <ImportDialog kind="contacts" open={imp === "contacts"} onOpenChange={(v) => setImp(v ? "contacts" : null)} onDone={reload} />
      <ImportDialog kind="recipients" open={imp === "recipients"} onOpenChange={(v) => setImp(v ? "recipients" : null)} onDone={reload} />
    </>
  );

  const content = empty ? (
      <div>
        <PageHeader title="Welcome to Campaign Pulse" description="Send with confidence. Understand every outcome." />
        <Card>
          <CardBody className="grid gap-8 py-10 md:grid-cols-[1.2fr_1fr] md:px-10">
            <div>
              <h2 className="text-xl">Your workspace is empty</h2>
              <p className="mt-2 max-w-lg text-sm text-muted-foreground">
                Campaign Pulse verifies event emails before they go out and shows exactly which addresses failed afterwards.
                Start by importing your data from CSV. Nothing is preloaded, and no real emails are ever sent in Simulation Mode.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                <Button onClick={() => setImp("contacts")}><Upload />Import contacts</Button>
                <Button variant="outline" asChild><Link href="/settings"><Plus />Add a sender</Link></Button>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">Sample files are in the <code className="rounded bg-muted px-1">sample-data/</code> folder of the project.</p>
            </div>
            <ol className="space-y-3 text-sm">
              {[[Database, "Import contacts", "contacts.csv: people, audiences, unsubscribes and suppressions"],
                [Upload, "Import campaign recipients", "Past delivery and engagement history (optional)"],
                [FilePlus2, "Create a campaign", "Seven guided steps, then verify before sending"],
                [BarChart3, "Review outcomes", "Delivery, bounces and recipient-level diagnostics"]].map(([Icon, t, d], i) => {
                const I = Icon as typeof Database;
                return (<li key={i} className="flex gap-3 rounded-md border p-3"><div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary"><I className="size-4" /></div><div><p className="font-medium">{i + 1}. {t as string}</p><p className="text-[13px] text-muted-foreground">{d as string}</p></div></li>);
              })}
            </ol>
          </CardBody>
        </Card>
      </div>
  ) : (
    <div>
      <PageHeader title="Overview" description="All campaigns, calculated from delivery records."
        actions={<>
          <Button variant="outline" size="sm" onClick={() => setImp("contacts")}><Upload />Import contacts</Button>
          <Button variant="outline" size="sm" onClick={() => setImp("recipients")}><Upload />Import recipients</Button>
          <Button size="sm" asChild><Link href="/campaigns/new"><Plus />New campaign</Link></Button>
        </>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Kpi label="Contacts" value={num(o.contacts)} />
        <Kpi label="Campaigns" value={num(o.campaign_count)} />
        <Kpi label="Attempted" value={num(o.kpis.attempted)} />
        <Kpi label="Delivery rate" value={pct(o.kpis.delivery_rate)} sub={`${num(o.kpis.delivered)} delivered`} />
        <Kpi label="Bounce rate" value={pct(o.kpis.bounce_rate)} sub={`${num(o.kpis.bounced)} bounced`} />
        <Kpi label="Open rate" value={pct(o.kpis.open_rate)} sub={`${num(o.kpis.unique_opens)} unique`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader title="Campaigns" description="Open a campaign to review it before sending or inspect results." />
          {cs.error ? <ErrorState message={cs.error.message} onRetry={cs.reload} /> : items.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No campaigns yet. <Link className="text-primary" href="/campaigns/new">Create your first campaign</Link>.</div>
          ) : (
            <Table>
              <THead><TR><TH>Campaign</TH><TH>Status</TH><TH className="text-right">Delivery</TH><TH className="text-right">Opens</TH><TH>Health</TH><TH>Updated</TH><TH /></TR></THead>
              <TBody>
                {items.map((c) => (
                  <TR key={c.id}>
                    <TD><Link href={`/review/${c.id}`} className="font-medium hover:text-primary">{c.name}</Link><p className="text-xs text-muted-foreground">{c.audience_name ?? "No audience"}</p></TD>
                    <TD><CampaignStatus status={c.status} /></TD>
                    <TD className="tabular text-right">{pct(c.kpis?.delivery_rate)}</TD>
                    <TD className="tabular text-right">{pct(c.kpis?.open_rate)}</TD>
                    <TD><HealthBadge health={c.health} /></TD>
                    <TD className="whitespace-nowrap text-muted-foreground">{fmtDate(c.updated_at, false)}</TD>
                    <TD className="text-right">
                      {c.status === "sent"
                        ? <Button variant="ghost" size="sm" asChild><Link href={`/analytics?campaign=${c.id}`}><BarChart3 />Analytics</Link></Button>
                        : <Button variant="ghost" size="sm" asChild><Link href={`/review/${c.id}`}><ClipboardCheck />Review</Link></Button>}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Insights" description="Rule-based, from your data" />
            <CardBody className="space-y-3">
              {o.insights.map((i) => (
                <div key={i.title} className="flex gap-2.5 text-[13px]"><Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" /><div><p className="font-medium">{i.title}</p><p className="text-muted-foreground">{i.message}</p></div></div>
              ))}
            </CardBody>
          </Card>
          <Notice tone="info"><span className="flex items-center gap-2"><Users className="size-4" />Diagnostics list every recipient who failed delivery.</span> <Link className="font-medium text-primary" href="/diagnostics?delivery_status=bounced">View bounced →</Link></Notice>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {content}
      {dialogs}
    </>
  );
}
