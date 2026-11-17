"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download, Search, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, ErrorState, Loading } from "@/components/ui/states";
import { DeliveryBadge } from "@/components/common";
import { API_BASE, api, qs } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { fmtDate } from "@/lib/utils";
import type { Page, RecipientRow } from "@/lib/types";

export type Filters = { q: string; campaign_id: string; delivery_status: string; bounce_type: string; engagement: string };
export const DEFAULT_FILTERS: Filters = { q: "", campaign_id: "all", delivery_status: "all", bounce_type: "all", engagement: "all" };

const BOUNCES = [["hard_bounce", "Hard bounce"], ["soft_bounce", "Soft bounce"], ["invalid_email", "Invalid email"], ["mailbox_unavailable", "Mailbox unavailable"], ["domain_issue", "Domain issue"], ["unknown", "Other / unknown"]];

export function RecipientTable({ filters, onFilters, campaigns, onSelect, hideCampaignFilter }: {
  filters: Filters; onFilters: (f: Filters) => void; campaigns: { id: number; name: string }[]; onSelect: (id: number) => void; hideCampaignFilter?: boolean;
}) {
  const [qInput, setQInput] = useState(filters.q);
  const [sort, setSort] = useState("last_activity");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const pageSize = 15;

  const latest = useRef(filters);
  latest.current = filters; // the debounce below must merge into the *current* filters, not a stale closure
  useEffect(() => setQInput(filters.q), [filters.q]);
  useEffect(() => {
    const t = setTimeout(() => { if (qInput !== latest.current.q) onFilters({ ...latest.current, q: qInput }); }, 300);
    return () => clearTimeout(t);
  }, [qInput]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setPage(1), [filters.q, filters.campaign_id, filters.delivery_status, filters.bounce_type, filters.engagement]);

  const query = { q: filters.q, campaign_id: filters.campaign_id, delivery_status: filters.delivery_status, bounce_type: filters.bounce_type, engagement: filters.engagement };
  const { data, error, loading, reload } = useApi(
    () => api<Page<RecipientRow>>(`/api/recipients${qs({ ...query, sort, order, page, page_size: pageSize })}`),
    [filters.q, filters.campaign_id, filters.delivery_status, filters.bounce_type, filters.engagement, sort, order, page],
  );
  const exportUrl = `${API_BASE}/api/exports/recipients${qs({ ...query, sort, order })}`;
  const set = (k: keyof Filters) => (v: string) => onFilters({ ...filters, [k]: v });
  const toggle = (col: string) => { if (sort === col) setOrder(order === "asc" ? "desc" : "asc"); else { setSort(col); setOrder("asc"); } };
  const SortIcon = ({ col }: { col: string }) => (sort !== col ? <ArrowUpDown className="size-3 opacity-40" /> : order === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />);
  const Th = ({ col, children }: { col: string; children: React.ReactNode }) => (
    <TH aria-sort={sort === col ? (order === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="inline-flex items-center gap-1 uppercase tracking-wide" onClick={() => toggle(col)} aria-label={`Sort by ${children}`}>{children}<SortIcon col={col} /></button>
    </TH>
  );
  const filtered = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS);

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b p-4">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input aria-label="Search recipients" placeholder="Search by name or email" className="pl-9" value={qInput} onChange={(e) => setQInput(e.target.value)} />
        </div>
        {!hideCampaignFilter && <Select aria-label="Campaign filter" className="w-48" value={filters.campaign_id} onValueChange={set("campaign_id")} options={[{ value: "all", label: "All campaigns" }, ...campaigns.map((c) => ({ value: String(c.id), label: c.name }))]} />}
        <Select aria-label="Delivery status filter" className="w-40" value={filters.delivery_status} onValueChange={set("delivery_status")} options={[{ value: "all", label: "All statuses" }, { value: "delivered", label: "Delivered" }, { value: "bounced", label: "Bounced" }, { value: "not_sent", label: "Not sent" }]} />
        <Select aria-label="Bounce type filter" className="w-44" value={filters.bounce_type} onValueChange={set("bounce_type")} options={[{ value: "all", label: "All bounce types" }, ...BOUNCES.map(([value, label]) => ({ value, label }))]} />
        <Select aria-label="Engagement filter" className="w-44" value={filters.engagement} onValueChange={set("engagement")} options={[{ value: "all", label: "Any engagement" }, { value: "opened", label: "Opened" }, { value: "clicked", label: "Clicked" }, { value: "opened_not_clicked", label: "Opened, not clicked" }, { value: "unopened", label: "Delivered, unopened" }]} />
        {filtered && <Button variant="ghost" size="sm" onClick={() => { onFilters({ ...DEFAULT_FILTERS, campaign_id: hideCampaignFilter ? filters.campaign_id : "all" }); setQInput(""); }}>Clear</Button>}
        <Button variant="outline" size="sm" asChild><a href={exportUrl} download data-testid="export-recipients"><Download />Export CSV</a></Button>
      </div>
      {loading && !data ? <Loading /> : error ? <ErrorState message={error.message} onRetry={reload} /> : data!.total === 0 ? (
        <EmptyState icon={<Users />} title={filtered ? "No recipients match these filters" : "No recipient records yet"}
          description={filtered ? "Try clearing a filter or searching for a different name or email." : "Import campaign recipients or execute a campaign to see recipient-level diagnostics."} />
      ) : (
        <>
          <Table data-testid="recipient-table">
            <THead><TR><Th col="name">Recipient</Th><Th col="email">Email</Th><Th col="campaign">Campaign</Th><Th col="status">Delivery</Th><TH>Bounce reason</TH><TH>Opened</TH><TH>Clicked</TH><Th col="last_activity">Last activity</Th></TR></THead>
            <TBody>{data!.items.map((r) => (
              <TR key={r.id} className="cursor-pointer" onClick={() => onSelect(r.id)}>
                <TD className="max-w-[180px] truncate font-medium" title={r.name}>{r.name}</TD>
                <TD className="max-w-[280px] truncate"><button className="text-left hover:text-primary hover:underline" onClick={(e) => { e.stopPropagation(); onSelect(r.id); }} aria-label={`Inspect ${r.email}`}>{r.email}</button></TD>
                <TD className="max-w-[160px] truncate text-muted-foreground" title={r.campaign_name}>{r.campaign_name}</TD>
                <TD><DeliveryBadge status={r.delivery_status} /></TD>
                <TD>{r.bounce_label ? <Badge tone="danger">{r.bounce_label}</Badge> : <span className="text-muted-foreground">—</span>}</TD>
                <TD>{r.delivery_status === "delivered" ? (r.opened ? <Badge tone="primary">Opened</Badge> : <span className="text-muted-foreground">No</span>) : <span className="text-muted-foreground">—</span>}</TD>
                <TD>{r.delivery_status === "delivered" ? (r.clicked ? <Badge tone="success">Clicked</Badge> : <span className="text-muted-foreground">No</span>) : <span className="text-muted-foreground">—</span>}</TD>
                <TD className="whitespace-nowrap text-muted-foreground">{fmtDate(r.last_activity)}</TD>
              </TR>))}</TBody>
          </Table>
          <div className="flex items-center justify-between border-t px-4 py-3 text-[13px] text-muted-foreground">
            <span data-testid="result-count">{data!.total.toLocaleString()} recipients · page {data!.page} of {data!.pages}</span>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft />Prev</Button>
              <Button variant="outline" size="sm" disabled={page >= data!.pages} onClick={() => setPage(page + 1)} aria-label="Next page">Next<ChevronRight /></Button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
