"use client";
import Link from "next/link";
import { ClipboardCheck, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, ErrorState, Loading } from "@/components/ui/states";
import { CampaignStatus, PageHeader } from "@/components/common";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { fmtDate } from "@/lib/utils";
import type { Campaign } from "@/lib/types";

export default function ReviewIndexPage() {
  const { data, error, loading, reload } = useApi(() => api<{ items: Campaign[] }>("/api/campaigns"), []);
  return (
    <div>
      <PageHeader title="Pre-send Review" description="Inspect sender, subject, audience and the rendered email without entering edit mode."
        actions={<Button asChild><Link href="/campaigns/new"><Plus />New campaign</Link></Button>} />
      <Card>
        {loading && !data ? <Loading /> : error ? <ErrorState message={error.message} onRetry={reload} /> : data!.items.length === 0 ? (
          <EmptyState icon={<ClipboardCheck />} title="No campaigns to review" description="Create a campaign to run the pre-send checklist and preview the email on desktop and mobile."
            action={<Button asChild><Link href="/campaigns/new">Create campaign</Link></Button>} />
        ) : (
          <Table><THead><TR><TH>Campaign</TH><TH>Subject</TH><TH>Audience</TH><TH>Status</TH><TH>Updated</TH><TH /></TR></THead>
            <TBody>{data!.items.map((c) => (
              <TR key={c.id}>
                <TD className="font-medium">{c.name}</TD>
                <TD className="max-w-[260px] truncate text-muted-foreground">{c.subject || <em>No subject</em>}</TD>
                <TD>{c.audience_name ?? "—"}</TD>
                <TD><CampaignStatus status={c.status} /></TD>
                <TD className="whitespace-nowrap text-muted-foreground">{fmtDate(c.updated_at, false)}</TD>
                <TD className="text-right"><Button size="sm" variant="outline" asChild><Link href={`/review/${c.id}`}>Open review</Link></Button></TD>
              </TR>))}</TBody></Table>
        )}
      </Card>
    </div>
  );
}
