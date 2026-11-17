"""Recipient-level diagnostics query (search, filters, sorting, pagination)."""
from sqlalchemy import Select, and_, case, exists, func, or_, select
from sqlalchemy.orm import Session

from app.models import Campaign, CampaignRecipient, CommunicationEvent, Contact, EmailDelivery, Suppression
from app.services.bounce import BOUNCE_LABELS

SORTS = {"name", "email", "campaign", "status", "last_activity"}


def _ev(kind: str):
    return select(func.min(CommunicationEvent.occurred_at)).where(
        CommunicationEvent.delivery_id == EmailDelivery.id, CommunicationEvent.event_type == kind).scalar_subquery()


def _last_activity():
    return select(func.max(CommunicationEvent.occurred_at)).where(
        CommunicationEvent.delivery_id == EmailDelivery.id).scalar_subquery()


def build_query(q=None, campaign_id=None, delivery_status=None, bounce_type=None, engagement=None,
                exclude_suppressed=False) -> Select:
    opened_at, clicked_at, last_ev = _ev("open"), _ev("click"), _last_activity()
    contact_status = case(
        (exists().where(Suppression.email_normalized == Contact.email_normalized, Suppression.kind == "unsubscribed"), "unsubscribed"),
        (exists().where(Suppression.email_normalized == Contact.email_normalized, Suppression.kind == "suppressed"), "suppressed"),
        else_="active")
    status = case((EmailDelivery.id.is_(None), "not_sent"), else_=EmailDelivery.status)
    stmt = (select(
        CampaignRecipient.id.label("id"), Contact.id.label("contact_id"), Contact.first_name, Contact.last_name,
        Contact.email, Campaign.id.label("campaign_id"), Campaign.name.label("campaign_name"),
        status.label("delivery_status"), EmailDelivery.bounce_type, EmailDelivery.bounce_reason,
        CampaignRecipient.eligibility, CampaignRecipient.exclusion_reason, contact_status.label("contact_status"),
        opened_at.label("opened_at"), clicked_at.label("clicked_at"), EmailDelivery.sent_at,
        func.coalesce(last_ev, EmailDelivery.sent_at).label("last_activity"),
        func.trim(Contact.first_name + " " + Contact.last_name).label("full_name"),
    ).join(Contact, Contact.id == CampaignRecipient.contact_id)
      .join(Campaign, Campaign.id == CampaignRecipient.campaign_id)
      .outerjoin(EmailDelivery, EmailDelivery.campaign_recipient_id == CampaignRecipient.id))
    conds = []
    if q and q.strip():
        like = "%" + q.strip().lower().replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_") + "%"
        conds.append(or_(func.lower(Contact.email).like(like, escape="\\"),
                         func.lower(Contact.first_name + " " + Contact.last_name).like(like, escape="\\")))
    if campaign_id:
        conds.append(CampaignRecipient.campaign_id == campaign_id)
    if delivery_status:
        conds.append(status == delivery_status)
    if bounce_type:
        conds.append(EmailDelivery.bounce_type == bounce_type)
    if engagement == "opened":
        conds.append(opened_at.is_not(None))
    elif engagement == "clicked":
        conds.append(clicked_at.is_not(None))
    elif engagement == "opened_not_clicked":
        conds.append(and_(opened_at.is_not(None), clicked_at.is_(None)))
    elif engagement == "unopened":
        conds.append(and_(EmailDelivery.status == "delivered", opened_at.is_(None)))
    if exclude_suppressed:
        conds.append(contact_status == "active")
    return stmt.where(*conds)


def sort_clause(stmt: Select, sort: str, order: str) -> Select:
    cols = {"name": func.lower(Contact.first_name + " " + Contact.last_name), "email": func.lower(Contact.email),
            "campaign": Campaign.name, "status": stmt.selected_columns.delivery_status,
            "last_activity": stmt.selected_columns.last_activity}
    col = cols.get(sort, cols["last_activity"])
    col = col.desc() if order == "desc" else col.asc()
    return stmt.order_by(col.nulls_last() if hasattr(col, "nulls_last") else col, CampaignRecipient.id)


def row_to_dict(r) -> dict:
    m = dict(r._mapping)
    m["name"] = (m.pop("full_name") or m["email"])
    m["opened"], m["clicked"] = m["opened_at"] is not None, m["clicked_at"] is not None
    m["bounce_label"] = BOUNCE_LABELS.get(m["bounce_type"]) if m["bounce_type"] else None
    return m


def list_recipients(session: Session, page: int, page_size: int, sort: str, order: str, **filters) -> dict:
    stmt = build_query(**filters)
    total = session.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    stmt = sort_clause(stmt, sort if sort in SORTS else "last_activity", order).limit(page_size).offset((page - 1) * page_size)
    items = [row_to_dict(r) for r in session.execute(stmt)]
    return {"items": items, "total": total, "page": page, "page_size": page_size,
            "pages": max(1, -(-total // page_size))}
