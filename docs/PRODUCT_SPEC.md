# Campaign Pulse — Product Spec

Independent product-extension concept for Airmeet event organizers. Not an official Airmeet product; no Airmeet API integration exists or is claimed.

## 1. Original customer requests (Airmeet public roadmap, both "Under Review")

**Request 1 — "More Details on Email Performance Data."** Airmeet provides email delivery statistics, but organizers want to know exactly which individual email addresses failed delivery instead of an overall delivery percentage.

**Request 2 — "Add subject line and further details to email preview."** Before sending, organizers want to verify the audience, sender address, subject line and the actual email, and to inspect these without entering edit mode for fear of accidentally modifying the email.

These are customer requests, not proof that Airmeet lacks analytics or previews. Campaign Pulse is an independent, enhanced implementation of the underlying workflows.

## 2. Product thesis
Event emails are high-stakes and time-boxed. Organizers need (a) a safe, read-only place to verify what will be sent and to whom, and (b) recipient-level evidence of what happened afterwards so failed addresses can be fixed. Campaign Pulse provides exactly those two things plus small follow-up helpers, and nothing else.

## 3. Target users
- **Event organizer / marketer** — sends invitations and reminders; needs confidence before sending and clarity afterwards.
- **Reviewer / approver (e.g. team lead)** — inspects a campaign without editing it.
- **Event ops** — cleans contact lists using bounce diagnostics.

## 4. User journeys
1. *Onboard:* open empty workspace → import contacts CSV → import campaign history CSV.
2. *Create & verify:* new campaign (7 steps) → read-only review (sender, subject, audience counts, desktop/mobile preview, checklist) → fix blockers via Edit → approve (acknowledging warnings) → execute in Simulation Mode.
3. *Analyze:* campaign analytics → filter by campaign, domain, date → inspect bounce reasons.
4. *Diagnose:* recipient table → search a failed address → filter hard bounces → open the recipient drawer.
5. *Follow up:* choose a segment → see who is included/excluded and why → generate/edit a draft → export eligible recipients.

## 5. Acceptance criteria

### Feature A — Pre-send verification (addresses Request 2)
- A1. The review page shows sender name/email, subject, preview text, audience name and counts (total, eligible, invalid, duplicate, suppressed, unsubscribed) without any editable control.
- A2. The email body renders as real HTML in a sandboxed iframe (`sandbox=""`), desktop (full width) and mobile (375px), personalized with a sample recipient; scripts and unsafe markup are stripped server-side.
- A3. Loading the review/preview any number of times leaves the campaign (`updated_at`, status, content) and delivery tables unchanged. **Edit** is a separate link.
- A4. 14 checks run server-side; each failure has severity (blocking / warning / information), explanation and suggestion.
- A5. Blocking issues prevent approval and execution (API returns 422/409). Warnings require explicit acknowledgement.
- A6. Readiness score = 100 − 25·blocking − 10·warning (floor 0), with rules shown in the UI.
- A7. Editing an approved campaign resets approval. A sent campaign cannot be edited.
- A8. Execution is idempotent: repeated calls create no additional deliveries/events.

### Feature B — Analytics & recipient diagnostics (addresses Request 1)
- B1. KPIs: attempted, delivered, bounced, delivery/bounce/open/click rates, unique opens/clicks — computed from rows; zero denominators render "—".
- B2. Charts (status donut, engagement bars, timeline, bounce reasons) are fed by API data and respond to campaign/domain/date filters.
- B3. The recipient table lists every recipient with name, email, campaign, delivery status, bounce class and reason, open/click state and last activity; supports search, filters, sorting, pagination and a detail drawer.
- B4. Bounce classes: hard, soft, invalid email, mailbox unavailable, domain issue, other/unknown. Reasons are shown only when the source provided one.
- B5. CSV export honours the current filters and neutralises formula injection.

### Supporting
- S1. Follow-up segments list each recipient with an include/exclude reason; unsubscribed, suppressed and permanently bounced (hard, invalid, domain) or unclassified recipients are never eligible. Drafts are editable and never sent.
- S2. CSV import shows a preview, rejects invalid rows with a downloadable report, and commits transactionally.
- S3. The UI states "Simulation Mode — No real emails are being sent." on every page.

## 6. How each feature answers the original request

| Customer need | Campaign Pulse |
| --- | --- |
| Which addresses failed? | Recipient Diagnostics: filter *Bounced* / bounce class, search an address, open the drawer for reason and history; export the list |
| More than a percentage | Bounce-reason distribution, per-recipient status, delivery vs engagement, follow-up segments |
| Is the audience right? | Review shows audience name and eligible/excluded counts with reasons |
| Which sender address? | Review shows sender name and email, validated |
| Is the subject right? | Review shows personalized subject, preview text and an inbox-style header |
| What does the email look like? | Sandboxed real-HTML preview, desktop and mobile |
| Don't let me break it | Review is read-only; Edit is separate; approval resets on change; viewing is tested to be non-mutating |

## 7. Out of scope
Event/registration/attendance management, CRM, marketing automation, scheduling, chatbots, enterprise integrations, real delivery, LLM features.
