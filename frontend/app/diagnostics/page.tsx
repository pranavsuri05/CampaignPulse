"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/common";
import { Loading } from "@/components/ui/states";
import { DEFAULT_FILTERS, RecipientTable, type Filters } from "@/components/recipient-table";
import { RecipientDrawer } from "@/components/recipient-drawer";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import type { Campaign } from "@/lib/types";

function Inner() {
  const sp = useSearchParams();
  const [filters, setFilters] = useState<Filters>({ ...DEFAULT_FILTERS, delivery_status: sp.get("delivery_status") ?? "all", campaign_id: sp.get("campaign") ?? "all" });
  const [selected, setSelected] = useState<number | null>(null);
  const cs = useApi(() => api<{ items: Campaign[] }>("/api/campaigns"), []);
  return (
    <div>
      <PageHeader title="Recipient Diagnostics" description="Find exactly which addresses failed delivery, why, and how each recipient engaged." />
      <RecipientTable filters={filters} onFilters={setFilters} campaigns={cs.data?.items ?? []} onSelect={setSelected} />
      <RecipientDrawer id={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
export default function DiagnosticsPage() { return <Suspense fallback={<Loading />}><Inner /></Suspense>; }
