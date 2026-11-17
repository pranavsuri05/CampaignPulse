"use client";
import { use } from "react";
import { CampaignWizard } from "@/components/campaign-wizard";
export default function EditCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <CampaignWizard campaignId={Number(id)} />;
}
