"""All metrics are computed from delivery and event rows; nothing is stored as a counter."""
from collections import Counter, defaultdict
from datetime import date, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Campaign, CampaignRecipient, CommunicationEvent, Contact, EmailDelivery
from app.services.bounce import BOUNCE_LABELS, BOUNCE_TYPES, PERMANENT
from app.services.metrics import build_insights, campaign_health, compute_kpis


def _delivery_filter(campaign_id: int | None, domain: str | None, date_from: date | None, date_to: date | None):
    conds = []
    if campaign_id is not None:
        conds.append(CampaignRecipient.campaign_id == campaign_id)
    if domain:
        conds.append(Contact.email_normalized.like("%@" + domain.lower().lstrip("@").replace("%", "").replace("_", r"\_"), escape="\\"))
    if date_from:
        conds.append(EmailDelivery.sent_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        conds.append(EmailDelivery.sent_at < datetime.combine(date_to, datetime.min.time()).replace(hour=23, minute=59, second=59, microsecond=999999))
    return conds


def analytics(session: Session, campaign_id: int | None = None, domain: str | None = None,
              date_from: date | None = None, date_to: date | None = None) -> dict:
    conds = _delivery_filter(campaign_id, domain, date_from, date_to)
    base = (select(EmailDelivery.id, EmailDelivery.status, EmailDelivery.bounce_type, EmailDelivery.sent_at, Contact.email_normalized)
            .join(CampaignRecipient, CampaignRecipient.id == EmailDelivery.campaign_recipient_id)
            .join(Contact, Contact.id == CampaignRecipient.contact_id).where(*conds))
    rows = session.execute(base).all()
    ids = {r.id for r in rows}
    attempted = len(rows)
    delivered = sum(1 for r in rows if r.status == "delivered")
    bounced = attempted - delivered

    opened: set[int] = set()
    clicked: set[int] = set()
    daily: dict[str, Counter] = defaultdict(Counter)
    if ids:
        ev_rows = session.execute(
            select(CommunicationEvent.delivery_id, CommunicationEvent.event_type, CommunicationEvent.occurred_at)
            .join(EmailDelivery, EmailDelivery.id == CommunicationEvent.delivery_id)
            .join(CampaignRecipient, CampaignRecipient.id == EmailDelivery.campaign_recipient_id)
            .join(Contact, Contact.id == CampaignRecipient.contact_id).where(*conds)
        ).all()
        for did, et, at in ev_rows:
            (opened if et == "open" else clicked).add(did)
            daily[at.date().isoformat()][et + "s"] += 1
    for r in rows:
        daily[r.sent_at.date().isoformat()]["sent"] += 1
        daily[r.sent_at.date().isoformat()]["bounced" if r.status == "bounced" else "delivered"] += 1

    kpis = compute_kpis(attempted, delivered, bounced, len(opened), len(clicked))
    bt = Counter(r.bounce_type or "unknown" for r in rows if r.status == "bounced")
    permanent = sum(v for k, v in bt.items() if k in PERMANENT)
    delivered_ids = {r.id for r in rows if r.status == "delivered"}
    opened_d = opened & delivered_ids
    clicked_d = clicked & delivered_ids
    engagement = [
        {"key": "no_engagement", "label": "No engagement", "count": len(delivered_ids - opened_d - clicked_d)},
        {"key": "opened_not_clicked", "label": "Opened, no click", "count": len(opened_d - clicked_d)},
        {"key": "clicked", "label": "Clicked", "count": len(clicked_d)},
    ]
    return {
        "campaign_id": campaign_id,
        "filters": {"domain": domain, "date_from": date_from.isoformat() if date_from else None,
                    "date_to": date_to.isoformat() if date_to else None},
        "kpis": kpis,
        "health": campaign_health(kpis),
        "status_breakdown": [{"key": "delivered", "label": "Delivered", "count": delivered},
                             {"key": "bounced", "label": "Bounced", "count": bounced}],
        "bounce_reasons": [{"key": k, "label": BOUNCE_LABELS[k], "count": bt.get(k, 0)} for k in BOUNCE_TYPES if bt.get(k, 0)],
        "engagement": engagement,
        "timeline": [{"date": d, "sent": c["sent"], "delivered": c["delivered"], "bounced": c["bounced"],
                      "opens": c["opens"], "clicks": c["clicks"]} for d, c in sorted(daily.items())],
        "insights": build_insights(kpis, permanent),
        "registrations": None,  # no registration data is ingested; never invented
    }


def campaign_stats(session: Session, ids: list[int]) -> dict[int, dict]:
    if not ids:
        return {}
    out = {}
    for cid in ids:
        k = analytics(session, campaign_id=cid)["kpis"]
        out[cid] = k
    return out


def overview(session: Session) -> dict:
    contacts = session.scalar(select(func.count(Contact.id))) or 0
    campaigns = list(session.scalars(select(Campaign).order_by(Campaign.updated_at.desc())))
    stats = campaign_stats(session, [c.id for c in campaigns])
    total = analytics(session)
    return {"contacts": contacts, "campaign_count": len(campaigns), "kpis": total["kpis"], "insights": total["insights"],
            "health": total["health"], "campaign_ids_with_stats": list(stats)}
