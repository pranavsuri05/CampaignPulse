from datetime import date

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.errors import Conflict, NotFound, Unprocessable
from app.models import Campaign, EmailTemplate, SenderConfiguration
from app.schemas import ApproveIn, CampaignCreate, CampaignOut, CampaignUpdate, DraftIn, TemplateOut, TemplateUpdate
from app.services import analytics as an
from app.services import campaigns as svc
from app.services import exports, followups
from app.services.emailutil import personalize, render_document
from app.services.provider import get_provider

router = APIRouter(prefix="/api", tags=["campaigns"])
CONTENT_FIELDS = {"subject", "preview_text", "body_html", "audience_name", "sender_email", "sender_name", "sender_id", "event_name", "name"}


def _apply_sender(db: Session, data: dict) -> None:
    sid = data.get("sender_id")
    if sid:
        s = db.get(SenderConfiguration, sid)
        if not s:
            raise Unprocessable(f"Sender {sid} does not exist")
        data.setdefault("sender_name", s.name)
        data.setdefault("sender_email", s.email)


@router.get("/campaigns")
def list_campaigns(status: str | None = None, q: str | None = None, db: Session = Depends(get_db)):
    stmt = select(Campaign).order_by(Campaign.updated_at.desc(), Campaign.id.desc())
    if status:
        stmt = stmt.where(Campaign.status == status)
    if q:
        stmt = stmt.where(Campaign.name.ilike(f"%{q}%"))
    items = list(db.scalars(stmt))
    stats = an.campaign_stats(db, [c.id for c in items])
    return {"items": [{**CampaignOut.model_validate(c).model_dump(mode="json", exclude={"body_html"}), "kpis": stats[c.id],
                       "health": __import__("app.services.metrics", fromlist=["x"]).campaign_health(stats[c.id])} for c in items],
            "total": len(items)}


@router.post("/campaigns", response_model=CampaignOut, status_code=201)
def create_campaign(body: CampaignCreate, db: Session = Depends(get_db)):
    data = body.model_dump(exclude_unset=True)
    _apply_sender(db, data)
    c = Campaign(**data)
    db.add(c)
    db.commit()
    return c


@router.get("/campaigns/{campaign_id}", response_model=CampaignOut)
def get_campaign(campaign_id: int, db: Session = Depends(get_db)):
    return svc.get_campaign(db, campaign_id)


@router.patch("/campaigns/{campaign_id}", response_model=CampaignOut)
def update_campaign(campaign_id: int, body: CampaignUpdate, db: Session = Depends(get_db)):
    c = svc.get_campaign(db, campaign_id)
    if c.status == "sent":
        raise Conflict("A sent campaign cannot be edited.")
    data = body.model_dump(exclude_unset=True)
    if data.get("name") is None:
        data.pop("name", None)
    _apply_sender(db, data)
    changed = any(getattr(c, k) != v for k, v in data.items())
    for k, v in data.items():
        setattr(c, k, v)
    if changed and c.status == "approved":  # editing invalidates approval
        c.status, c.approved_at, c.warnings_acknowledged = "draft", None, False
    db.commit()
    return c


@router.delete("/campaigns/{campaign_id}", status_code=204)
def delete_campaign(campaign_id: int, db: Session = Depends(get_db)):
    db.delete(svc.get_campaign(db, campaign_id))
    db.commit()
    return Response(status_code=204)


@router.post("/campaigns/{campaign_id}/validate")
def validate_campaign(campaign_id: int, db: Session = Depends(get_db)):
    return svc.validate_campaign(db, svc.get_campaign(db, campaign_id))


@router.post("/campaigns/{campaign_id}/approve", response_model=CampaignOut)
def approve_campaign(campaign_id: int, body: ApproveIn | None = None, db: Session = Depends(get_db)):
    return svc.approve(db, svc.get_campaign(db, campaign_id), bool(body and body.acknowledge_warnings))


@router.post("/campaigns/{campaign_id}/execute")
def execute_campaign(campaign_id: int, db: Session = Depends(get_db)):
    return svc.execute(db, svc.get_campaign(db, campaign_id), get_provider())


@router.get("/campaigns/{campaign_id}/preview")
def preview_campaign(campaign_id: int, contact_id: int | None = None, db: Session = Depends(get_db)):
    return svc.preview(db, svc.get_campaign(db, campaign_id), contact_id)


@router.get("/campaigns/{campaign_id}/analytics")
def campaign_analytics(campaign_id: int, domain: str | None = None, date_from: date | None = None,
                       date_to: date | None = None, db: Session = Depends(get_db)):
    svc.get_campaign(db, campaign_id)
    return an.analytics(db, campaign_id, domain, date_from, date_to)


@router.get("/campaigns/{campaign_id}/followups")
def followup_segments(campaign_id: int, db: Session = Depends(get_db)):
    svc.get_campaign(db, campaign_id)
    return {"segments": followups.segments_overview(db, campaign_id)}


@router.get("/campaigns/{campaign_id}/followups/export")
def followup_export(campaign_id: int, segment: str, include_excluded: bool = False, db: Session = Depends(get_db)):
    svc.get_campaign(db, campaign_id)
    csv_text, n = exports.followup_csv(followups.segment_members(db, campaign_id, segment), only_eligible=not include_excluded)
    return Response(csv_text, media_type="text/csv", headers={
        "Content-Disposition": f'attachment; filename="followup-{campaign_id}-{segment}.csv"', "X-Row-Count": str(n)})


@router.post("/campaigns/{campaign_id}/followups/draft", response_model=TemplateOut, status_code=201)
def create_followup_draft(campaign_id: int, body: DraftIn, db: Session = Depends(get_db)):
    return followups.create_draft(db, svc.get_campaign(db, campaign_id), body.segment)


@router.get("/campaigns/{campaign_id}/templates", response_model=list[TemplateOut])
def campaign_templates(campaign_id: int, db: Session = Depends(get_db)):
    return list(db.scalars(select(EmailTemplate).where(EmailTemplate.campaign_id == campaign_id).order_by(EmailTemplate.id)))


@router.patch("/templates/{template_id}", response_model=TemplateOut)
def update_template(template_id: int, body: TemplateUpdate, db: Session = Depends(get_db)):
    t = db.get(EmailTemplate, template_id)
    if not t:
        raise NotFound("Template not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        if v is not None:
            setattr(t, k, v)
    db.commit()
    return t


@router.get("/templates/{template_id}/preview")
def template_preview(template_id: int, db: Session = Depends(get_db)):
    t = db.get(EmailTemplate, template_id)
    if not t:
        raise NotFound("Template not found")
    c = db.get(Campaign, t.campaign_id) if t.campaign_id else None
    values = svc.sample_values(c) if c else {"first_name": "Alex", "event_name": "Your event", "unsubscribe_url": "#"}
    return {"subject": personalize(t.subject, values, escape=False), "html": render_document(t.body_html, values)}


_ = Query
