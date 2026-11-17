import json
from datetime import date

from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.errors import Conflict, NotFound, Unprocessable
from app.models import CampaignRecipient, CommunicationEvent, Contact, SenderConfiguration, Suppression
from app.schemas import RenderIn, SenderIn, SenderOut
from app.services import analytics as an
from app.services import audience as aud
from app.services import exports, imports
from app.services.bounce import BOUNCE_LABELS, BOUNCE_TYPES
from app.services.campaigns import get_campaign, sample_values
from app.services.emailutil import is_valid_email, render_document
from app.services.recipients import build_query, list_recipients, row_to_dict

router = APIRouter(prefix="/api", tags=["data"])
SORT = Query("last_activity")
ORDER = Query("desc", pattern="^(asc|desc)$")


@router.get("/health", tags=["meta"])
def health(db: Session = Depends(get_db)):
    db.execute(select(1))
    return {"status": "ok", "mode": "simulation", "message": "Simulation Mode — No real emails are being sent."}


@router.get("/meta", tags=["meta"])
def meta():
    return {"bounce_types": [{"key": k, "label": BOUNCE_LABELS[k]} for k in BOUNCE_TYPES], "mode": "simulation"}


@router.get("/overview", tags=["meta"])
def overview(db: Session = Depends(get_db)):
    return an.overview(db)


@router.get("/analytics", tags=["analytics"])
def global_analytics(campaign_id: int | None = None, domain: str | None = None, date_from: date | None = None,
                     date_to: date | None = None, db: Session = Depends(get_db)):
    if campaign_id is not None:
        get_campaign(db, campaign_id)
    return an.analytics(db, campaign_id, domain, date_from, date_to)


@router.get("/audiences", tags=["audience"])
def audiences(db: Session = Depends(get_db)):
    return {"items": aud.list_audiences(db)}


@router.get("/contacts/count", tags=["audience"])
def contact_count(db: Session = Depends(get_db)):
    return {"count": len(list(db.scalars(select(Contact.id))))}


@router.post("/render", tags=["preview"])
def render(body: RenderIn, db: Session = Depends(get_db)):
    """Stateless sanitised render for the composer. Writes nothing."""
    from app.models import Campaign

    contact = db.get(Contact, body.contact_id) if body.contact_id else None
    if contact is None and body.audience_name:
        contact = next((r.contact for r in aud.resolve_audience(db, body.audience_name) if r.eligibility == "eligible"), None)
    fake = Campaign(name=body.campaign_name or "Campaign", event_name=body.event_name)
    return {"html": render_document(body.html, sample_values(fake, contact))}


# ---- recipients -------------------------------------------------------------
def _filters(q, campaign_id, delivery_status, bounce_type, engagement, exclude_suppressed=False):
    return dict(q=q, campaign_id=campaign_id, delivery_status=delivery_status, bounce_type=bounce_type,
                engagement=engagement, exclude_suppressed=exclude_suppressed)


@router.get("/recipients", tags=["recipients"])
def recipients(q: str | None = None, campaign_id: int | None = None,
               delivery_status: str | None = Query(None, pattern="^(delivered|bounced|not_sent)$"),
               bounce_type: str | None = None,
               engagement: str | None = Query(None, pattern="^(opened|clicked|unopened|opened_not_clicked)$"),
               sort: str = SORT, order: str = ORDER, page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=200),
               db: Session = Depends(get_db)):
    return list_recipients(db, page, page_size, sort, order, **_filters(q, campaign_id, delivery_status, bounce_type, engagement))


@router.get("/recipients/{recipient_id}", tags=["recipients"])
def recipient_detail(recipient_id: int, db: Session = Depends(get_db)):
    from app.models import EmailDelivery

    row = db.execute(build_query().where(CampaignRecipient.id == recipient_id)).first()
    if not row:
        raise NotFound("Recipient not found")
    d = row_to_dict(row)
    events = list(db.execute(select(CommunicationEvent.event_type, CommunicationEvent.occurred_at, CommunicationEvent.url)
                             .join(EmailDelivery, EmailDelivery.id == CommunicationEvent.delivery_id)
                             .where(EmailDelivery.campaign_recipient_id == recipient_id).order_by(CommunicationEvent.occurred_at)))
    contact = db.get(Contact, d["contact_id"])
    sup = list(db.scalars(select(Suppression).where(Suppression.email_normalized == contact.email_normalized)))
    history = db.execute(build_query().where(CampaignRecipient.contact_id == d["contact_id"])).all()
    return {**{k: (v.isoformat() + "Z" if hasattr(v, "isoformat") else v) for k, v in d.items()},
            "audience": contact.audience, "is_valid_email": contact.is_valid_email,
            "suppressions": [{"kind": s.kind, "reason": s.reason} for s in sup],
            "events": [{"type": t, "at": a.isoformat() + "Z", "url": u} for t, a, u in events],
            "other_campaigns": [{"id": h.id, "campaign_name": h.campaign_name, "delivery_status": h.delivery_status}
                                for h in history if h.id != recipient_id]}


# ---- import -----------------------------------------------------------------
async def _import(kind: str, file: UploadFile, mapping: str | None, commit: bool, db: Session):
    raw = await file.read(get_max() + 1)
    text = imports.read_upload(file.filename, file.content_type, raw)
    try:
        m = json.loads(mapping) if mapping else None
    except json.JSONDecodeError:
        raise Unprocessable("mapping must be valid JSON") from None
    fn = imports.import_contacts if kind == "contacts" else imports.import_campaign_recipients
    return fn(db, text, m, dry_run=not commit)


def get_max() -> int:
    from app.config import get_settings

    return get_settings().max_upload_bytes


@router.post("/import/contacts", tags=["import"])
async def import_contacts(file: UploadFile = File(...), mapping: str | None = Form(None), commit: bool = Form(False),
                          db: Session = Depends(get_db)):
    return await _import("contacts", file, mapping, commit, db)


@router.post("/import/campaign-recipients", tags=["import"])
async def import_campaign_recipients(file: UploadFile = File(...), mapping: str | None = Form(None),
                                     commit: bool = Form(False), db: Session = Depends(get_db)):
    return await _import("recipients", file, mapping, commit, db)


# ---- export -----------------------------------------------------------------
@router.get("/exports/recipients", tags=["export"])
def export_recipients(q: str | None = None, campaign_id: int | None = None,
                      delivery_status: str | None = Query(None, pattern="^(delivered|bounced|not_sent)$"),
                      bounce_type: str | None = None,
                      engagement: str | None = Query(None, pattern="^(opened|clicked|unopened|opened_not_clicked)$"),
                      exclude_suppressed: bool = False, sort: str = SORT, order: str = ORDER, db: Session = Depends(get_db)):
    text, n = exports.recipients_csv(db, sort, order, **_filters(q, campaign_id, delivery_status, bounce_type, engagement, exclude_suppressed))
    return Response(text, media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="recipients.csv"', "X-Row-Count": str(n)})


@router.get("/exports/campaigns/{campaign_id}/summary", tags=["export"])
def export_summary(campaign_id: int, db: Session = Depends(get_db)):
    c = get_campaign(db, campaign_id)
    text = exports.summary_csv(c.name, an.analytics(db, campaign_id)["kpis"])
    return Response(text, media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="campaign-{campaign_id}-summary.csv"'})


# ---- senders ----------------------------------------------------------------
@router.get("/settings/senders", response_model=list[SenderOut], tags=["settings"])
def list_senders(db: Session = Depends(get_db)):
    return list(db.scalars(select(SenderConfiguration).order_by(SenderConfiguration.id)))


@router.post("/settings/senders", response_model=SenderOut, status_code=201, tags=["settings"])
def create_sender(body: SenderIn, db: Session = Depends(get_db)):
    if not is_valid_email(body.email):
        raise Unprocessable("Sender email is not a valid address.")
    email = body.email.strip().lower()
    if db.scalar(select(SenderConfiguration).where(SenderConfiguration.email == email)):
        raise Conflict("A sender with this email already exists.")
    if body.is_default:
        for s in db.scalars(select(SenderConfiguration)):
            s.is_default = False
    s = SenderConfiguration(name=body.name.strip(), email=email, is_default=body.is_default)
    db.add(s)
    db.commit()
    return s


@router.delete("/settings/senders/{sender_id}", status_code=204, tags=["settings"])
def delete_sender(sender_id: int, db: Session = Depends(get_db)):
    s = db.get(SenderConfiguration, sender_id)
    if not s:
        raise NotFound("Sender not found")
    db.delete(s)
    db.commit()
    return Response(status_code=204)
