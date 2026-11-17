import { z } from "zod";

export const CAMPAIGN_TYPES = [
  { value: "invitation", label: "Invitation" },
  { value: "reminder", label: "Reminder" },
  { value: "announcement", label: "Announcement" },
  { value: "follow_up", label: "Follow-up" },
  { value: "thank_you", label: "Thank you" },
  { value: "newsletter", label: "Newsletter" },
] as const;

export const VARIABLES = ["first_name", "last_name", "full_name", "email", "event_name", "campaign_name", "unsubscribe_url"] as const;

export const campaignSchema = z.object({
  name: z.string().trim().min(1, "Campaign name is required").max(200, "Keep the name under 200 characters"),
  campaign_type: z.enum(["invitation", "reminder", "announcement", "follow_up", "thank_you", "newsletter"]),
  event_name: z.string().trim().max(200).optional().or(z.literal("")),
  sender_id: z.string().optional(),
  sender_name: z.string().trim().min(1, "Sender name is required").max(200),
  sender_email: z.string().trim().min(1, "Sender email is required").email("Enter a valid email address"),
  subject: z.string().trim().min(1, "Subject line is required").max(998),
  preview_text: z.string().trim().max(500, "Preview text is too long").optional().or(z.literal("")),
  audience_name: z.string().min(1, "Select an audience"),
  body_html: z.string().trim().min(1, "Email content is required"),
});
export type CampaignForm = z.infer<typeof campaignSchema>;

export const STEPS = [
  { key: "details", label: "Details", fields: ["name", "campaign_type", "event_name"] },
  { key: "sender", label: "Sender", fields: ["sender_name", "sender_email"] },
  { key: "subject", label: "Subject", fields: ["subject", "preview_text"] },
  { key: "audience", label: "Audience", fields: ["audience_name"] },
  { key: "content", label: "Content", fields: ["body_html"] },
  { key: "review", label: "Review", fields: [] },
  { key: "approve", label: "Approve & run", fields: [] },
] as const;

export const senderSchema = z.object({
  name: z.string().trim().min(1, "Sender name is required").max(200),
  email: z.string().trim().min(1, "Sender email is required").email("Enter a valid email address"),
});
export type SenderForm = z.infer<typeof senderSchema>;

export const STARTER_TEMPLATES: Record<string, string> = {
  Invitation: `<h1 style="font-size:24px;margin:0 0 12px">You're invited, {{first_name}}</h1>
<p>Join us for <strong>{{event_name}}</strong>. Save your spot and get the joining details by email.</p>
<p><a href="https://example.com/register" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none">Register now</a></p>
<p style="color:#667085;font-size:12px">You received this because you are on our event list. <a href="{{unsubscribe_url}}">Unsubscribe</a></p>`,
  Reminder: `<p>Hi {{first_name}},</p>
<p>A quick reminder that <strong>{{event_name}}</strong> starts soon.</p>
<p><a href="https://example.com/join">Open your event link</a></p>
<p style="color:#667085;font-size:12px"><a href="{{unsubscribe_url}}">Unsubscribe</a></p>`,
};
