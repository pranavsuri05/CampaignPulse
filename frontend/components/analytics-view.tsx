"use client";
import { useEffect, useState } from "react";
import { BarChart3, Download, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { EmptyState, ErrorState, Loading } from "@/components/ui/states";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RecipientTable, DEFAULT_FILTERS, type Filters } from "@/components/recipient-table";
import { RecipientDrawer } from "@/components/recipient-drawer";
import { Followups } from "@/components/followups";
import { EngagementBars, HBar, StatusDonut, Timeline } from "@/components/charts";
import { HealthBadge, Kpi, Notice, PageHeader } from "@/components/common";
import { API_BASE, api, qs } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { num, pct } from "@/lib/utils";
import type { Analytics, Campaign } from "@/lib/types";
import Link from "next/link";

export function AnalyticsView({ initialCampaign }: { initialCampaign?: string }) {
  const cs = useApi(() => api<{ items: Campaign[] }>("/api/campaigns"), []);
  const [campaign, setCampaign] = useState(initialCampaign ?? "all");
  const [domain, setDomain] = useState("");
  const [domainApplied, setDomainApplied] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [filters, setFilters] = useState<Filters>({ ...DEFAULT_FILTERS, campaign_id: initialCampaign ?? "all" });
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => { const t = setTimeout(() => setDomainApplied(domain.trim()), 350); return () => clearTimeout(t); }, [domain]);
  useEffect(() => setFilters((f) => ({ ...f, campaign_id: campaign })), [campaign]);

  const sent = (cs.data?.items ?? []).filter((c) => c.status === "sent");
  const a = useApi(() => api<Analytics>(`/api/analytics${qs({ campaign_id: campaign, domain: domainApplied, date_from: from, date_to: to })}`), [campaign, domainApplied, from, to]);

  if (cs.loading && !cs.data) return <Loading />;
  if (cs.error) return <ErrorState message={cs.error.message} onRetry={cs.reload} />;
  if (sent.length === 0)
    return (<div><PageHeader title="Email Analytics" description="Delivery, bounce and engagement metrics from delivery records." />
      <Card><EmptyState icon={<BarChart3 />} title="No sent campaigns yet" description="Analytics appear after a campaign has been executed in Simulation Mode, or once you import campaign recipients."
        action={<div className="flex gap-2"><Button asChild><Link href="/campaigns/new">Create campaign</Link></Button><Button variant="outline" asChild><Link href="/settings">Import data</Link></Button></div>} /></Card></div>);

  const d = a.data;
  const k = d?.kpis;
  const filtersActive = campaign !== "all" || domainApplied || from || to;
  return (
    <div>
      <PageHeader title="Email Analytics" description="Calculated from delivery and event records. Nothing here is a stored counter."
        actions={campaign !== "all" ? <Button variant="outline" size="sm" asChild><a href={`${API_BASE}/api/exports/campaigns/${campaign}/summary`} download><Download />Export summary</a></Button> : undefined} />
      <Card className="mb-6"><CardBody className="flex flex-wrap items-end gap-4 py-4">
        <div className="w-56"><Label htmlFor="a-campaign">Campaign</Label>
          <Select id="a-campaign" value={campaign} onValueChange={setCampaign} options={[{ value: "all", label: "All sent campaigns" }, ...sent.map((c) => ({ value: String(c.id), label: c.name }))]} /></div>
        <div className="w-48"><Label htmlFor="a-domain">Recipient domain</Label><Input id="a-domain" placeholder="e.g. example.com" value={domain} onChange={(e) => setDomain(e.target.value)} /></div>
        <div><Label htmlFor="a-from">Sent from</Label><Input id="a-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><Label htmlFor="a-to">Sent to</Label><Input id="a-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        {filtersActive && <Button variant="ghost" size="sm" onClick={() => { setCampaign("all"); setDomain(""); setFrom(""); setTo(""); }}>Reset filters</Button>}
        {d && <div className="ml-auto flex items-center gap-2 text-[13px] text-muted-foreground">Campaign health <HealthBadge health={d.health} /></div>}
      </CardBody></Card>

      {a.error ? <ErrorState message={a.error.message} onRetry={a.reload} /> : !d || !k ? <Loading /> : (
        <Tabs defaultValue="dashboard">
          <TabsList aria-label="Analytics sections"><TabsTrigger value="dashboard">Dashboard</TabsTrigger><TabsTrigger value="recipients">Recipients</TabsTrigger><TabsTrigger value="followups" disabled={campaign === "all"}>Follow-ups</TabsTrigger></TabsList>

          <TabsContent value="dashboard" className="mt-5 space-y-6">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" data-testid="kpis">
              <Kpi label="Attempted recipients" value={num(k.attempted)} />
              <Kpi label="Delivered" value={num(k.delivered)} sub={`Delivery rate ${pct(k.delivery_rate)}`} hint="Delivered ÷ Attempted × 100" />
              <Kpi label="Bounced" value={num(k.bounced)} sub={`Bounce rate ${pct(k.bounce_rate)}`} hint="Bounced ÷ Attempted × 100" />
              <Kpi label="Unique opens" value={num(k.unique_opens)} sub={`Open rate ${pct(k.open_rate)}`} hint="Unique opens ÷ Delivered × 100" />
              <Kpi label="Unique clicks" value={num(k.unique_clicks)} sub={`Click rate ${pct(k.click_rate)}`} hint="Unique clicks ÷ Delivered × 100" />
            </div>
            <dl className="sr-only"><dt>Delivery rate</dt><dd data-testid="m-delivery-rate">{pct(k.delivery_rate)}</dd><dt>Bounce rate</dt><dd data-testid="m-bounce-rate">{pct(k.bounce_rate)}</dd><dt>Open rate</dt><dd data-testid="m-open-rate">{pct(k.open_rate)}</dd><dt>Click rate</dt><dd data-testid="m-click-rate">{pct(k.click_rate)}</dd></dl>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card><CardHeader title="Delivery status" description="Delivered vs bounced" /><CardBody><StatusDonut data={d.status_breakdown} /></CardBody></Card>
              <Card><CardHeader title="Engagement" description="Among delivered emails" /><CardBody><EngagementBars delivered={k.delivered} opens={k.unique_opens} clicks={k.unique_clicks} /></CardBody></Card>
              <Card className="lg:col-span-2"><CardHeader title="Performance over time" description="Daily sends, bounces, opens and clicks (event timestamps)" /><CardBody><Timeline data={d.timeline} /></CardBody></Card>
              <Card><CardHeader title="Bounce reasons" description="Classified from source bounce data" /><CardBody><HBar testId="chart-bounces" data={d.bounce_reasons} color="hsl(0 68% 52%)" /></CardBody></Card>
              <Card><CardHeader title="Insights" description="Rule-based, derived from the metrics above" />
                <CardBody className="space-y-3">{d.insights.map((i) => (
                  <div key={i.title} className="flex gap-2.5 text-[13px]"><Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" /><div><p className="font-medium">{i.title}</p><p className="text-muted-foreground">{i.message}</p></div></div>))}</CardBody></Card>
            </div>
            <Notice tone="info" title="How metrics are defined">
              Delivery rate = delivered ÷ attempted · Bounce rate = bounced ÷ attempted · Open rate = unique opens ÷ delivered · Click rate = unique clicks ÷ delivered. Rates show “—” when the denominator is zero.
              Opens and clicks are approximate: privacy proxies and security scanners can inflate or hide them. No registration data has been imported, so no registration conversion is shown.
            </Notice>
          </TabsContent>

          <TabsContent value="recipients" className="mt-5">
            <RecipientTable filters={filters} onFilters={setFilters} campaigns={sent} onSelect={setSelected} hideCampaignFilter />
          </TabsContent>
          <TabsContent value="followups" className="mt-5">{campaign !== "all" && <Followups campaignId={Number(campaign)} />}</TabsContent>
        </Tabs>
      )}
      <RecipientDrawer id={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
