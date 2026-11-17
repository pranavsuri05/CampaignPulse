export type Kpis = {
  attempted: number; delivered: number; bounced: number; delivery_rate: number | null; bounce_rate: number | null;
  unique_opens: number; open_rate: number | null; unique_clicks: number; click_rate: number | null;
};
export type Health = { label: string; level: "good" | "warn" | "bad" | "neutral" };
export type Insight = { level: string; title: string; message: string };
export type Campaign = {
  id: number; name: string; campaign_type: string; event_name: string | null; status: "draft" | "approved" | "sent";
  source: string; sender_id: number | null; sender_name: string | null; sender_email: string | null; subject: string | null;
  preview_text: string | null; audience_name: string | null; body_html: string | null; approved_at: string | null;
  executed_at: string | null; created_at: string; updated_at: string; kpis?: Kpis; health?: Health;
};
export type AudienceCounts = { total: number; eligible: number; invalid: number; duplicate: number; unsubscribed: number; suppressed: number };
export type Audience = AudienceCounts & { name: string };
export type Check = { id: string; label: string; status: "pass" | "fail"; severity: "blocking" | "warning" | "information"; message: string; suggestion: string | null };
export type Validation = {
  campaign_id: number; checks: Check[]; audience: AudienceCounts; blocking_count: number; warning_count: number; info_count: number;
  can_approve: boolean; requires_acknowledgement: boolean; readiness_score: number; score_rules: string;
};
export type Preview = {
  campaign_id: number; status: string; name: string; sender: { name: string | null; email: string | null }; subject: string;
  preview_text: string; audience: { name: string | null } & AudienceCounts; html: string;
  sample_recipient: { id: number; name: string; email: string } | null;
};
export type Analytics = {
  kpis: Kpis; health: Health; insights: Insight[];
  status_breakdown: { key: string; label: string; count: number }[];
  bounce_reasons: { key: string; label: string; count: number }[];
  engagement: { key: string; label: string; count: number }[];
  timeline: { date: string; sent: number; delivered: number; bounced: number; opens: number; clicks: number }[];
  registrations: null;
};
export type RecipientRow = {
  id: number; contact_id: number; name: string; email: string; campaign_id: number; campaign_name: string;
  delivery_status: "delivered" | "bounced" | "not_sent"; bounce_type: string | null; bounce_label: string | null; bounce_reason: string | null;
  eligibility: string; exclusion_reason: string | null; contact_status: string; opened: boolean; clicked: boolean;
  opened_at: string | null; clicked_at: string | null; sent_at: string | null; last_activity: string | null;
};
export type Page<T> = { items: T[]; total: number; page: number; page_size: number; pages: number };
export type RecipientDetail = RecipientRow & {
  audience: string | null; is_valid_email: boolean; suppressions: { kind: string; reason: string | null }[];
  events: { type: string; at: string; url: string | null }[]; other_campaigns: { id: number; campaign_name: string; delivery_status: string }[];
};
export type Sender = { id: number; name: string; email: string; is_default: boolean };
export type ImportIssue = { row: number; severity: "error" | "warning"; code: string; message: string; field: string | null };
export type ImportResult = {
  dry_run: boolean; headers: string[]; mapping: Record<string, string | null>; missing_required: string[]; total_rows: number;
  valid_rows: number; imported_rows: number; rejected_rows: number; warning_rows: number; issues: ImportIssue[];
  preview: { row: number; status: string; email: string; message: string }[]; summary: Record<string, number>;
};
export type FollowupMember = RecipientRow & { included: boolean; reason: string };
export type FollowupSegment = { key: string; label: string; description: string; total: number; eligible: number; excluded: number; members: FollowupMember[] };
export type Template = { id: number; name: string; subject: string; body_html: string; segment: string | null; campaign_id: number | null };
export type Overview = { contacts: number; campaign_count: number; kpis: Kpis; insights: Insight[]; health: Health };
