"""CSV import with header detection, column mapping, validation and a dry-run preview."""
import csv
import io
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.errors import AppError, PayloadTooLarge, Unprocessable
from app.models import Campaign, CampaignRecipient, CommunicationEvent, Contact, EmailDelivery, Suppression
from app.services.bounce import BOUNCE_TYPES, classify_bounce
from app.services.emailutil import is_valid_email, normalize_email

CONTACT_FIELDS = {
    "contact_id": (True, ("contact_id", "id", "contactid", "external_id")),
    "email": (True, ("email", "email_address", "e-mail")),
    "first_name": (False, ("first_name", "firstname", "first", "given_name")),
    "last_name": (False, ("last_name", "lastname", "last", "surname", "family_name")),
    "audience": (False, ("audience", "list", "segment", "group")),
    "status": (False, ("status", "contact_status", "subscription_status")),
    "suppression_reason": (False, ("suppression_reason", "reason", "unsubscribe_reason")),
}
RECIPIENT_FIELDS = {
    "campaign_name": (True, ("campaign_name", "campaign")),
    "contact_id": (True, ("contact_id", "id", "contactid", "external_id")),
    "delivery_status": (True, ("delivery_status", "status", "outcome")),
    "bounce_type": (False, ("bounce_type", "bounce_category")),
    "bounce_reason": (False, ("bounce_reason", "bounce_message", "smtp_response")),
    "sent_at": (False, ("sent_at", "sent", "send_time")),
    "opened_at": (False, ("opened_at", "open_time", "first_open_at")),
    "clicked_at": (False, ("clicked_at", "click_time", "first_click_at")),
    "campaign_type": (False, ("campaign_type", "type")),
    "subject": (False, ("subject", "subject_line")),
    "sender_name": (False, ("sender_name", "from_name")),
    "sender_email": (False, ("sender_email", "from_email")),
}


@dataclass
class Issue:
    row: int
    severity: str  # error|warning
    code: str
    message: str
    field: str | None = None

    def asdict(self) -> dict:
        return self.__dict__.copy()


@dataclass
class Parsed:
    headers: list[str]
    mapping: dict[str, str | None]
    missing_required: list[str]
    rows: list[tuple[int, dict[str, str]]]
    issues: list[Issue] = field(default_factory=list)


def read_upload(filename: str | None, content_type: str | None, raw: bytes) -> str:
    s = get_settings()
    if len(raw) > s.max_upload_bytes:
        raise PayloadTooLarge(f"File exceeds the {s.max_upload_bytes // (1024 * 1024)} MB limit.")
    if not (filename or "").lower().endswith(".csv"):
        raise Unprocessable("Only .csv files are supported.")
    if content_type and content_type.split(";")[0].strip().lower() not in (
            "text/csv", "application/csv", "application/vnd.ms-excel", "text/plain", "application/octet-stream"):
        raise Unprocessable("Unsupported file type; upload a CSV file.")
    if b"\x00" in raw:
        raise Unprocessable("File looks binary, not a CSV.")
    if not raw.strip():
        raise Unprocessable("The CSV file is empty.")
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError as e:
        raise Unprocessable("File is not valid UTF-8 text.") from e


def parse_csv(text: str, spec: dict, mapping_override: dict | None = None) -> Parsed:
    try:
        reader = csv.reader(io.StringIO(text, newline=""), strict=True)
        all_rows = list(reader)
    except csv.Error as e:
        raise Unprocessable(f"Malformed CSV: {e}") from e
    all_rows = [r for r in all_rows if any(c.strip() for c in r)] if all_rows else []
    if not all_rows:
        raise Unprocessable("The CSV file is empty.")
    headers = [h.strip() for h in all_rows[0]]
    if len(set(h.lower() for h in headers)) != len(headers):
        raise Unprocessable("Duplicate column headers detected.")
    lower = {h.lower(): h for h in headers}
    mapping: dict[str, str | None] = {}
    for fld, (_, synonyms) in spec.items():
        chosen = (mapping_override or {}).get(fld)
        if chosen and chosen in headers:
            mapping[fld] = chosen
        else:
            mapping[fld] = next((lower[s] for s in synonyms if s in lower), None)
    missing = [f for f, (req, _) in spec.items() if req and not mapping[f]]
    max_rows = get_settings().max_import_rows
    if len(all_rows) - 1 > max_rows:
        raise PayloadTooLarge(f"Too many rows (limit {max_rows}).")
    p = Parsed(headers, mapping, missing, [])
    for i, r in enumerate(all_rows[1:], start=2):
        if len(r) > len(headers):
            p.issues.append(Issue(i, "error", "too_many_columns", f"Row has {len(r)} fields but header has {len(headers)}."))
            continue
        r = r + [""] * (len(headers) - len(r))
        p.rows.append((i, {h: v.strip() for h, v in zip(headers, r, strict=False)}))
    return p


def _get(row: dict, mapping: dict, f: str) -> str:
    col = mapping.get(f)
    return row.get(col, "") if col else ""


def _dt(v: str) -> datetime | None:
    v = v.strip()
    if not v:
        return None
    dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
    if dt.tzinfo is not None:
        dt = dt.astimezone(UTC).replace(tzinfo=None)
    return dt


def _result(p: Parsed, dry_run: bool, valid: int, imported: int, extra: dict, preview: list) -> dict:
    errors = [i for i in p.issues if i.severity == "error"]
    return {
        "dry_run": dry_run, "headers": p.headers, "mapping": p.mapping, "missing_required": p.missing_required,
        "total_rows": len(p.rows) + sum(1 for i in p.issues if i.code == "too_many_columns"),
        "valid_rows": valid, "imported_rows": imported, "rejected_rows": len({i.row for i in errors}),
        "warning_rows": len({i.row for i in p.issues if i.severity == "warning"}),
        "issues": [i.asdict() for i in p.issues], "preview": preview[:10], "summary": extra,
    }


def import_contacts(session: Session, text: str, mapping: dict | None, dry_run: bool) -> dict:
    p = parse_csv(text, CONTACT_FIELDS, mapping)
    if p.missing_required:
        if dry_run:  # let the UI offer column mapping
            return _result(p, True, 0, 0, {}, [])
        raise Unprocessable("Missing required columns: " + ", ".join(p.missing_required), {"mapping": p.mapping, "headers": p.headers})
    existing_ids = set(session.scalars(select(Contact.external_id)))
    email_owner: dict[str, str] = {normalize_email(e): x for e, x in session.execute(select(Contact.email_normalized, Contact.external_id))}
    seen_ids: set[str] = set()
    new: list[Contact] = []
    supp: dict[tuple[str, str], str | None] = {}
    preview: list[dict] = []
    counts = {"invalid_email": 0, "duplicate_email": 0, "unsubscribed": 0, "suppressed": 0, "already_imported": 0}
    for line, row in p.rows:
        g = lambda f, row=row: _get(row, p.mapping, f)  # noqa: E731
        cid, email, status = g("contact_id"), g("email"), (g("status") or "active").lower()
        err = None
        if not cid:
            err = ("missing_contact_id", "contact_id is required", "contact_id")
        elif not email:
            err = ("missing_email", "email is required", "email")
        elif cid in existing_ids or cid in seen_ids:
            err = ("duplicate_contact_id", f"contact_id '{cid}' already exists; row skipped", "contact_id")
            counts["already_imported"] += 1
        elif len(g("first_name")) > 255 or len(g("last_name")) > 255:
            err = ("name_too_long", "Name exceeds 255 characters", "first_name")
        elif status not in ("active", "unsubscribed", "suppressed"):
            err = ("invalid_status", f"status '{status}' must be active, unsubscribed or suppressed", "status")
        if err:
            p.issues.append(Issue(line, "error", err[0], err[1], err[2]))
            preview.append({"row": line, "status": "error", "email": email, "message": err[1]})
            continue
        seen_ids.add(cid)
        norm = normalize_email(email)
        valid = is_valid_email(email)
        msgs = []
        if not valid:
            counts["invalid_email"] += 1
            p.issues.append(Issue(line, "warning", "invalid_email", f"'{email}' is not a valid address; imported but flagged invalid.", "email"))
            msgs.append("invalid email")
        elif norm in email_owner:
            counts["duplicate_email"] += 1
            p.issues.append(Issue(line, "warning", "duplicate_email", f"Same address as contact {email_owner[norm]}; imported, will be de-duplicated when sending.", "email"))
            msgs.append("duplicate email")
        else:
            email_owner[norm] = cid
        new.append(Contact(external_id=cid, first_name=g("first_name"), last_name=g("last_name"), email=email,
                           email_normalized=norm, audience=g("audience") or None, is_valid_email=valid))
        if status in ("unsubscribed", "suppressed"):
            counts[status] += 1
            supp[(norm, status)] = g("suppression_reason") or None
        preview.append({"row": line, "status": "warning" if msgs else "ok", "email": email, "message": ", ".join(msgs)})
    imported = 0
    if not dry_run:
        try:
            session.add_all(new)
            have = set(session.execute(select(Suppression.email_normalized, Suppression.kind)).all())
            for (norm, kind), reason in supp.items():
                if (norm, kind) not in have:
                    session.add(Suppression(email_normalized=norm, kind=kind, reason=reason))
            session.commit()
            imported = len(new)
        except Exception:
            session.rollback()
            raise AppError("Import failed and was rolled back; no data was changed.") from None
    return _result(p, dry_run, len(new), imported, {**counts, "contacts": len(new)}, preview)


def import_campaign_recipients(session: Session, text: str, mapping: dict | None, dry_run: bool) -> dict:
    p = parse_csv(text, RECIPIENT_FIELDS, mapping)
    if p.missing_required:
        if dry_run:  # let the UI offer column mapping
            return _result(p, True, 0, 0, {}, [])
        raise Unprocessable("Missing required columns: " + ", ".join(p.missing_required), {"mapping": p.mapping, "headers": p.headers})
    contacts = {c.external_id: c for c in session.scalars(select(Contact))}
    camps = {c.name: c for c in session.scalars(select(Campaign))}
    existing_pairs = set(session.execute(select(CampaignRecipient.campaign_id, CampaignRecipient.contact_id)).all())
    seen: set[tuple[str, int]] = set()
    plan: list[dict] = []
    preview: list[dict] = []
    new_campaigns: dict[str, dict] = {}
    for line, row in p.rows:
        g = lambda f, row=row: _get(row, p.mapping, f)  # noqa: E731
        name, cid, status = g("campaign_name"), g("contact_id"), g("delivery_status").lower().replace(" ", "_")
        err = None
        times: dict[str, datetime | None] = {}
        if not name:
            err = ("missing_campaign", "campaign_name is required", "campaign_name")
        elif cid not in contacts:
            err = ("unknown_contact", f"contact_id '{cid}' does not exist; import contacts first", "contact_id")
        elif status not in ("delivered", "bounced", "not_sent"):
            err = ("invalid_status", f"delivery_status '{status}' must be delivered, bounced or not_sent", "delivery_status")
        else:
            try:
                times = {k: _dt(g(k)) for k in ("sent_at", "opened_at", "clicked_at")}
            except ValueError:
                err = ("invalid_timestamp", "Timestamps must be ISO 8601 (e.g. 2026-03-01T09:30:00)", "sent_at")
        if not err:
            key = (name, contacts[cid].id)
            c = camps.get(name)
            if key in seen or (c and (c.id, contacts[cid].id) in existing_pairs):
                err = ("duplicate_row", "This campaign/contact pair already exists; row skipped", "contact_id")
            elif status != "delivered" and (times["opened_at"] or times["clicked_at"]):
                err = ("engagement_without_delivery", "Opens/clicks are only valid for delivered emails", "opened_at")
            elif status != "not_sent" and not times["sent_at"]:
                err = ("missing_sent_at", "sent_at is required for delivered/bounced rows", "sent_at")
            elif c and c.source != "import":
                err = ("campaign_not_importable", f"Campaign '{name}' was created in the app and cannot be extended by import", "campaign_name")
        if err:
            p.issues.append(Issue(line, "error", err[0], err[1], err[2]))
            preview.append({"row": line, "status": "error", "email": contacts[cid].email if cid in contacts else cid, "message": err[1]})
            continue
        seen.add(key)
        btype = reason = None
        if status == "bounced":
            reason = g("bounce_reason") or None
            btype = g("bounce_type").lower() or classify_bounce(reason)
            if btype not in BOUNCE_TYPES:
                p.issues.append(Issue(line, "warning", "unknown_bounce_type", f"bounce_type '{btype}' not recognised; classified from reason.", "bounce_type"))
                btype = classify_bounce(reason)
            if not reason:
                p.issues.append(Issue(line, "warning", "no_bounce_reason", "No bounce reason supplied by source; stored as unknown reason.", "bounce_reason"))
        if name not in camps and name not in new_campaigns:
            new_campaigns[name] = {"type": g("campaign_type") or "invitation", "subject": g("subject") or None,
                                   "sender_name": g("sender_name") or None, "sender_email": g("sender_email") or None}
        plan.append({"name": name, "contact": contacts[cid], "status": status, "btype": btype, "reason": reason, **times})
        preview.append({"row": line, "status": "ok", "email": contacts[cid].email, "message": status})
    imported = 0
    if not dry_run:
        try:
            for name, meta in new_campaigns.items():
                c = Campaign(name=name, campaign_type=meta["type"], status="sent", source="import", subject=meta["subject"],
                             sender_name=meta["sender_name"], sender_email=meta["sender_email"], audience_name="Imported",
                             executed_at=min((x["sent_at"] for x in plan if x["name"] == name and x["sent_at"]), default=None))
                session.add(c)
                camps[name] = c
            session.flush()
            for x in plan:
                cr = CampaignRecipient(campaign_id=camps[x["name"]].id, contact_id=x["contact"].id,
                                       eligibility="eligible" if x["status"] != "not_sent" else "suppressed",
                                       exclusion_reason=None if x["status"] != "not_sent" else "Not sent (excluded in source data)")
                session.add(cr)
                session.flush()
                if x["status"] == "not_sent":
                    continue
                d = EmailDelivery(campaign_recipient_id=cr.id, status=x["status"], bounce_type=x["btype"],
                                  bounce_reason=x["reason"], provider="import", sent_at=x["sent_at"])
                session.add(d)
                session.flush()
                if x["opened_at"]:
                    session.add(CommunicationEvent(delivery_id=d.id, event_type="open", occurred_at=x["opened_at"]))
                if x["clicked_at"]:
                    session.add(CommunicationEvent(delivery_id=d.id, event_type="click", occurred_at=x["clicked_at"]))
            session.commit()
            imported = len(plan)
        except Exception:
            session.rollback()
            raise AppError("Import failed and was rolled back; no data was changed.") from None
    return _result(p, dry_run, len(plan), imported, {"campaigns_created": len(new_campaigns), "deliveries": sum(1 for x in plan if x["status"] != "not_sent")}, preview)
