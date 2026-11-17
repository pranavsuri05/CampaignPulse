# Sample data

Fictional people and `example.com` addresses only. Regenerate deterministically with `python3 scripts/generate_sample_data.py`.
Nothing is imported automatically: the application starts with an empty database.

## Files

| File | Rows | Purpose |
| --- | --- | --- |
| `contacts.csv` | 260 | People, audiences, unsubscribes and suppressions |
| `campaign_recipients.csv` | 360 | Historical delivery/engagement for 3 imported campaigns |

**Import order matters:** contacts first, then campaign recipients (rows reference `contact_id`).

## What the data demonstrates

`contacts.csv` (columns `contact_id, first_name, last_name, email, audience, status, suppression_reason`)
- 3 audiences: *Webinar Registrants* (110), *Past Attendees* (80), *Newsletter Subscribers* (60) + 10 extra duplicate rows
- 15 `unsubscribed`, 10 `suppressed` contacts (with reasons)
- 8 invalid email addresses (imported but flagged invalid)
- 10 duplicate email addresses under different `contact_id`s (different letter case)
- 1 contact with a very long surname

`campaign_recipients.csv` (columns `campaign_name, campaign_type, subject, sender_name, sender_email, contact_id, delivery_status, bounce_type, bounce_reason, sent_at, opened_at, clicked_at`)
- 3 campaigns: *Spring Summit — Save the Date*, *— Final Reminder*, *— Thank You*
- `delivery_status`: `delivered`, `bounced`, `not_sent` (unsubscribed/suppressed contacts that were excluded)
- All six bounce classes: hard bounce, soft bounce, invalid email, mailbox unavailable, domain issue, other/unknown (blank reason)
- Opened, unopened, clicked, and delivered-with-no-engagement emails

## Expected import result

- Contacts: 260 imported, 0 rejected, 18 warnings (8 invalid + 10 duplicate emails)
- Campaign recipients: 360 imported, 0 rejected, 3 campaigns created

## Trying the pre-send flow

After importing, create a campaign and choose the **Newsletter Subscribers** audience (it has not been used by any imported campaign).
The review screen will show invalid, duplicate, unsubscribed and suppressed counts, and execution will skip all of them.

## CSV column mapping

Headers are auto-detected (e.g. `id`/`email_address` are recognised). If a required column is not detected, the import dialog lets you
map it manually. `status` values: `active`, `unsubscribed`, `suppressed`. Timestamps: ISO 8601 (`2026-09-01T09:00:00`).
