"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AnalyticsView } from "@/components/analytics-view";
import { Loading } from "@/components/ui/states";

function Inner() {
  const sp = useSearchParams();
  return <AnalyticsView initialCampaign={sp.get("campaign") ?? undefined} />;
}
export default function AnalyticsPage() { return <Suspense fallback={<Loading />}><Inner /></Suspense>; }
