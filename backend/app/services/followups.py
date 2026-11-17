"""Deterministic follow-up segments and draft templates. Never sends anything."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import NotFound, Unprocessable
from app.models import Campaign, EmailTemplate
from app.services.bounce import BOUNCE_LABELS, PERMANENT, RETRYABLE
from app.services.recipients import build_query, row_to_dict

SEGMENTS = {
    "bounced": ("Bounced recipients", "Emails that failed delivery. Only temporary failures are eligible for a retry."),
    "unopened": ("Delivered, not opened", "Delivered emails with no recorded open or click."),
    "opened_not_clicked": ("Opened, not clicked", "Recipients who opened but did not click."),
}


def _filters(segment: str) -> dict:
    return {"bounced": {"delivery_status": "bounced"}, "unopened": {"engagement": "unopened"},
            "opened_not_clicked": {"engagement": "opened_not_clicked"}}[segment]


def decide(segment: str, row: dict) -> tuple[bool, str]:
    cs = row["contact_status"]
    if cs == "unsubscribed":
        return False, "Excluded: contact has unsubscribed"
    if cs == "suppressed":
        return False, "Excluded: address is on the suppression list"
    bt = row["bounce_type"]
    if segment == "bounced":
        if bt in PERMANENT:
            return False, f"Excluded: permanent failure ({BOUNCE_LABELS[bt]}); correct the address first"
        if bt in RETRYABLE:
            return True, f"Included: temporary failure ({BOUNCE_LABELS[bt]}); retry is reasonable"
        return False, "Excluded: bounce could not be classified; verify the address first"
    if segment == "unopened":
        return True, "Included: delivered with no recorded open"
    return True, "Included: opened but did not click"


def segment_members(session: Session, campaign_id: int, segment: str) -> list[dict]:
    if segment not in SEGMENTS:
        raise NotFound(f"Unknown segment '{segment}'")
    from sqlalchemy import func

    from app.models import Contact

    stmt = build_query(campaign_id=campaign_id, **_filters(segment)).order_by(func.lower(Contact.email))
    out = []
    for r in session.execute(stmt):
        d = row_to_dict(r)
        d["included"], d["reason"] = decide(segment, d)
        out.append(d)
    return out


def segments_overview(session: Session, campaign_id: int) -> list[dict]:
    res = []
    for key, (label, desc) in SEGMENTS.items():
        m = segment_members(session, campaign_id, key)
        inc = sum(1 for x in m if x["included"])
        res.append({"key": key, "label": label, "description": desc, "total": len(m), "eligible": inc,
                    "excluded": len(m) - inc, "members": m[:300]})
    return res


_BODY = {
    "bounced": ("Resending: {s}", "<p>Hi {{first_name}},</p><p>Our earlier message about <strong>{{event_name}}</strong> may not have reached you. We're resending it now.</p><p><a href=\"https://example.com/register\">View details and register</a></p><p>Thanks,<br>The event team</p><p style=\"font-size:12px;color:#666\"><a href=\"{{unsubscribe_url}}\">Unsubscribe</a></p>"),
    "unopened": ("Did you miss this? {s}", "<p>Hi {{first_name}},</p><p>We wanted to make sure you saw our note about <strong>{{event_name}}</strong>. Here is a quick recap and the link to take the next step.</p><p><a href=\"https://example.com/register\">See the details</a></p><p>Thanks,<br>The event team</p><p style=\"font-size:12px;color:#666\"><a href=\"{{unsubscribe_url}}\">Unsubscribe</a></p>"),
    "opened_not_clicked": ("Quick reminder: {s}", "<p>Hi {{first_name}},</p><p>Thanks for taking a look at <strong>{{event_name}}</strong>. If you'd like to join, it only takes a minute.</p><p><a href=\"https://example.com/register\">Reserve your spot</a></p><p>Thanks,<br>The event team</p><p style=\"font-size:12px;color:#666\"><a href=\"{{unsubscribe_url}}\">Unsubscribe</a></p>"),
}


def create_draft(session: Session, c: Campaign, segment: str) -> EmailTemplate:
    if segment not in SEGMENTS:
        raise Unprocessable(f"Unknown segment '{segment}'")
    existing = session.scalar(select(EmailTemplate).where(
        EmailTemplate.campaign_id == c.id, EmailTemplate.segment == segment, EmailTemplate.kind == "followup_draft"))
    if existing:
        return existing
    subj, body = _BODY[segment]
    t = EmailTemplate(name=f"{SEGMENTS[segment][0]} follow-up — {c.name}", kind="followup_draft", campaign_id=c.id,
                      segment=segment, subject=subj.format(s=c.subject or c.name), body_html=body)
    session.add(t)
    session.commit()
    return t
