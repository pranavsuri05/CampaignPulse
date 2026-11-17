"""Campaign lifecycle: validation checklist, approval, execution, preview."""
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.db import utcnow
from app.errors import Conflict, NotFound, Unprocessable
from app.models import Campaign, CampaignRecipient, CommunicationEvent, EmailDelivery
from app.services import audience as aud
from app.services.emailutil import (
    ALLOWED_VARIABLES,
    invalid_links,
    is_valid_email,
    render_document,
    unsupported_variables,
)
from app.services.provider import EmailProvider, OutboundMessage

BLOCKING, WARNING, INFO = "blocking", "warning", "information"
# Readiness score: start at 100, subtract 25 per failed blocking check and 10 per failed warning. Floor 0.
SCORE_BLOCKING, SCORE_WARNING = 25, 10


def get_campaign(session: Session, campaign_id: int) -> Campaign:
    c = session.get(Campaign, campaign_id)
    if not c:
        raise NotFound(f"Campaign {campaign_id} not found")
    return c


def sample_values(campaign: Campaign, contact=None) -> dict[str, str]:
    from app.config import get_settings

    if contact is None:
        first, last, email = "Alex", "Morgan", "alex.morgan@example.com"
    else:
        first, last, email = contact.first_name, contact.last_name, contact.email
    return {
        "first_name": first, "last_name": last, "full_name": f"{first} {last}".strip(), "email": email,
        "event_name": campaign.event_name or campaign.name, "campaign_name": campaign.name,
        "unsubscribe_url": f"{get_settings().unsubscribe_base_url}?e=preview",
    }


def check(id_: str, label: str, ok: bool, severity: str, fail_msg: str, suggestion: str, ok_msg: str = "OK") -> dict:
    return {"id": id_, "label": label, "status": "pass" if ok else "fail", "severity": severity,
            "message": ok_msg if ok else fail_msg, "suggestion": None if ok else suggestion}


def validate_campaign(session: Session, c: Campaign) -> dict:
    resolved = aud.resolve_audience(session, c.audience_name)
    counts = aud.summarize(resolved)
    audience_exists = bool(c.audience_name) and (c.audience_name == aud.ALL_CONTACTS and counts["total"] > 0 or counts["total"] > 0)
    bad_vars = unsupported_variables(c.subject, c.preview_text, c.body_html)
    bad_links = invalid_links(c.body_html)
    s_email = (c.sender_email or "").strip()
    checks = [
        check("sender_name", "Sender name exists", bool((c.sender_name or "").strip()), BLOCKING,
              "No sender name is set.", "Add the name recipients will see, e.g. your event team."),
        check("sender_email_present", "Sender email exists", bool(s_email), BLOCKING,
              "No sender email is set.", "Choose a saved sender or enter a sender address."),
        check("sender_email_valid", "Sender email is valid", (not s_email) or is_valid_email(s_email), BLOCKING,
              f"'{s_email}' is not a valid email address.", "Correct the sender address format (name@domain.com)."),
        check("subject", "Subject line exists", bool((c.subject or "").strip()), BLOCKING,
              "The subject line is empty.", "Write a clear subject line."),
        check("preview_text", "Preview text is available", bool((c.preview_text or "").strip()), WARNING,
              "No preview text is set; inboxes will show the first line of the body.",
              "Add 40–90 characters of preview text."),
        check("audience_exists", "Audience exists", audience_exists, BLOCKING,
              "No audience is selected, or the selected audience has no contacts.",
              "Import contacts and choose an audience."),
        check("eligible", "Audience contains eligible recipients", counts["eligible"] > 0, BLOCKING,
              "There are no eligible recipients to send to.", "Choose a different audience or fix the excluded contacts.",
              f"{counts['eligible']} eligible recipients"),
        check("invalid", "Invalid addresses identified", counts["invalid"] == 0, WARNING,
              f"{counts['invalid']} recipients have invalid addresses and will be excluded.",
              "Correct these addresses in your contact source and re-import.", "No invalid addresses"),
        check("duplicates", "Duplicate addresses identified", counts["duplicate"] == 0, INFO,
              f"{counts['duplicate']} duplicate addresses will be sent to once only.",
              "No action required; consider cleaning duplicates at the source.", "No duplicates"),
        check("unsubscribed", "Unsubscribed recipients excluded", counts["unsubscribed"] == 0, INFO,
              f"{counts['unsubscribed']} unsubscribed contacts are excluded automatically.", "No action required.",
              "No unsubscribed contacts in audience"),
        check("suppressed", "Suppressed recipients excluded", counts["suppressed"] == 0, INFO,
              f"{counts['suppressed']} suppressed addresses are excluded automatically.", "No action required.",
              "No suppressed addresses in audience"),
        check("body", "Email body exists", bool((c.body_html or "").strip()), BLOCKING,
              "The email body is empty.", "Compose the email content."),
        check("variables", "Personalization variables are valid", not bad_vars, BLOCKING,
              "Unsupported variables: " + ", ".join(f"{{{{{v}}}}}" for v in bad_vars),
              "Use only: " + ", ".join(f"{{{{{v}}}}}" for v in ALLOWED_VARIABLES)),
        check("links", "Email links are valid", not bad_links, WARNING,
              f"{len(bad_links)} link(s) look invalid: " + ", ".join(bad_links[:3]),
              "Use full https:// links, or {{unsubscribe_url}}."),
    ]
    failed = [x for x in checks if x["status"] == "fail"]
    nb = sum(1 for x in failed if x["severity"] == BLOCKING)
    nw = sum(1 for x in failed if x["severity"] == WARNING)
    score = max(0, 100 - SCORE_BLOCKING * nb - SCORE_WARNING * nw)
    return {
        "campaign_id": c.id, "checks": checks, "audience": counts,
        "blocking_count": nb, "warning_count": nw,
        "info_count": sum(1 for x in failed if x["severity"] == INFO),
        "can_approve": nb == 0, "requires_acknowledgement": nw > 0,
        "readiness_score": score,
        "score_rules": f"100 − {SCORE_BLOCKING} per blocking issue − {SCORE_WARNING} per warning (min 0). Information items do not affect the score.",
    }


def approve(session: Session, c: Campaign, acknowledge_warnings: bool) -> Campaign:
    if c.status == "sent":
        raise Conflict("Campaign has already been sent.")
    report = validate_campaign(session, c)
    if not report["can_approve"]:
        raise Unprocessable("Campaign has blocking issues and cannot be approved.", report)
    if report["requires_acknowledgement"] and not acknowledge_warnings:
        raise Unprocessable("Warnings must be explicitly acknowledged before approval.", report)
    c.status, c.approved_at, c.warnings_acknowledged = "approved", utcnow(), acknowledge_warnings
    session.commit()
    return c


def preview(session: Session, c: Campaign, contact_id: int | None = None) -> dict:
    """Read-only: never writes to the database."""
    resolved = aud.resolve_audience(session, c.audience_name)
    counts = aud.summarize(resolved)
    sample = None
    for r in resolved:
        if (contact_id and r.contact.id == contact_id) or (not contact_id and r.eligibility == "eligible"):
            sample = r.contact
            break
    values = sample_values(c, sample)
    from app.services.emailutil import personalize

    return {
        "campaign_id": c.id, "status": c.status, "name": c.name,
        "sender": {"name": c.sender_name, "email": c.sender_email},
        "subject": personalize(c.subject or "", values, escape=False),
        "preview_text": personalize(c.preview_text or "", values, escape=False),
        "audience": {"name": c.audience_name, **counts},
        "html": render_document(c.body_html, values),
        "sample_recipient": {"id": sample.id, "name": sample.full_name, "email": sample.email} if sample else None,
    }


def execute(session: Session, c: Campaign, provider: EmailProvider) -> dict:
    """Idempotent execution. Returns already_executed=True on repeat calls without writing anything."""
    if c.status == "sent":
        return execution_summary(session, c, already=True)
    if c.status != "approved":
        raise Conflict("Campaign must be approved before it can be executed.")
    if validate_campaign(session, c)["blocking_count"]:
        raise Unprocessable("Campaign has blocking issues.")
    # compare-and-set claim: only one caller can move approved -> sent
    claimed = session.execute(
        update(Campaign).where(Campaign.id == c.id, Campaign.status == "approved").values(status="sending")
    ).rowcount
    if not claimed:
        session.rollback()
        session.refresh(c)
        return execution_summary(session, c, already=True)
    try:
        now = utcnow()
        existing = {r.contact_id: r for r in session.scalars(select(CampaignRecipient).where(CampaignRecipient.campaign_id == c.id))}
        for r in aud.resolve_audience(session, c.audience_name):
            cr = existing.get(r.contact.id)
            if cr is None:
                cr = CampaignRecipient(campaign_id=c.id, contact_id=r.contact.id)
                session.add(cr)
            cr.eligibility, cr.exclusion_reason = r.eligibility, r.reason
            if r.eligibility != "eligible":
                continue
            session.flush()
            if session.scalar(select(EmailDelivery.id).where(EmailDelivery.campaign_recipient_id == cr.id)):
                continue
            values = sample_values(c, r.contact)
            from app.services.emailutil import personalize

            out = provider.send(OutboundMessage(
                campaign_name=c.name, sender_email=c.sender_email or "", to_email=r.contact.email,
                subject=personalize(c.subject or "", values, escape=False),
                html=render_document(c.body_html, values), sent_at=now,
            ))
            d = EmailDelivery(campaign_recipient_id=cr.id, status=out.status, bounce_type=out.bounce_type,
                              bounce_reason=out.bounce_reason, provider=provider.name, sent_at=now)
            session.add(d)
            session.flush()
            for e in out.events:
                session.add(CommunicationEvent(delivery_id=d.id, event_type=e.event_type, occurred_at=e.occurred_at, url=e.url))
        c.status, c.executed_at = "sent", now
        session.commit()
    except Exception:
        session.rollback()
        raise
    return execution_summary(session, c, already=False)


def execution_summary(session: Session, c: Campaign, already: bool) -> dict:
    from app.services.analytics import analytics

    return {"campaign_id": c.id, "status": c.status, "already_executed": already, "provider": "simulation",
            "simulation": True, "kpis": analytics(session, campaign_id=c.id)["kpis"]}
