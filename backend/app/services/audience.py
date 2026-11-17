"""Audience resolution: who would receive a campaign and who is excluded (and why)."""
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Contact, Suppression

ALL_CONTACTS = "All contacts"

REASONS = {
    "invalid": "Email address is not valid",
    "duplicate": "Duplicate of another address in this audience",
    "unsubscribed": "Contact has unsubscribed",
    "suppressed": "Address is on the suppression list",
}


@dataclass
class Resolved:
    contact: Contact
    eligibility: str  # eligible|invalid|duplicate|unsubscribed|suppressed
    reason: str | None


def suppression_map(session: Session) -> dict[str, str]:
    """email_normalized -> 'unsubscribed' | 'suppressed' (unsubscribed wins)."""
    result: dict[str, str] = {}
    for email, kind in session.execute(select(Suppression.email_normalized, Suppression.kind)):
        if result.get(email) != "unsubscribed":
            result[email] = kind
    return result


def resolve_audience(session: Session, audience_name: str | None) -> list[Resolved]:
    if not audience_name:
        return []
    stmt = select(Contact).order_by(Contact.id)
    if audience_name != ALL_CONTACTS:
        stmt = stmt.where(Contact.audience == audience_name)
    sup = suppression_map(session)
    seen: set[str] = set()
    out: list[Resolved] = []
    for c in session.scalars(stmt):
        if not c.is_valid_email:
            out.append(Resolved(c, "invalid", REASONS["invalid"]))
        elif c.email_normalized in seen:
            out.append(Resolved(c, "duplicate", REASONS["duplicate"]))
        elif sup.get(c.email_normalized) in ("unsubscribed", "suppressed"):
            k = sup[c.email_normalized]
            seen.add(c.email_normalized)
            out.append(Resolved(c, k, REASONS[k]))
        else:
            seen.add(c.email_normalized)
            out.append(Resolved(c, "eligible", None))
    return out


def summarize(resolved: list[Resolved]) -> dict:
    counts = {"eligible": 0, "invalid": 0, "duplicate": 0, "unsubscribed": 0, "suppressed": 0}
    for r in resolved:
        counts[r.eligibility] += 1
    return {"total": len(resolved), **counts}


def list_audiences(session: Session) -> list[dict]:
    names = [n for (n,) in session.execute(select(Contact.audience).where(Contact.audience.is_not(None)).distinct().order_by(Contact.audience))]
    total = session.scalar(select(func.count(Contact.id))) or 0
    out = []
    if total:
        out.append({"name": ALL_CONTACTS, **summarize(resolve_audience(session, ALL_CONTACTS))})
    for n in names:
        out.append({"name": n, **summarize(resolve_audience(session, n))})
    return out
