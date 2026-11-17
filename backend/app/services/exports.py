import csv
import io

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.services.emailutil import csv_safe
from app.services.recipients import build_query, row_to_dict, sort_clause

COLUMNS = ["recipient_id", "name", "email", "campaign", "delivery_status", "bounce_type", "bounce_reason", "opened",
           "clicked", "last_activity", "audience_eligibility", "contact_status"]


def to_csv(headers: list[str], rows: list[list]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow([csv_safe(h) for h in headers])
    for r in rows:
        w.writerow([csv_safe(v) for v in r])
    return buf.getvalue()


def recipients_csv(session: Session, sort="last_activity", order="desc", **filters) -> tuple[str, int]:
    stmt = sort_clause(build_query(**filters), sort, order)
    rows = []
    for r in session.execute(stmt):
        d = row_to_dict(r)
        rows.append([d["id"], d["name"], d["email"], d["campaign_name"], d["delivery_status"], d["bounce_type"] or "",
                     d["bounce_reason"] or "", "yes" if d["opened"] else "no", "yes" if d["clicked"] else "no",
                     d["last_activity"].isoformat() if d["last_activity"] else "", d["eligibility"], d["contact_status"]])
    return to_csv(COLUMNS, rows), len(rows)


def followup_csv(members: list[dict], only_eligible: bool = True) -> tuple[str, int]:
    rows = [[m["id"], m["name"], m["email"], m["campaign_name"], m["delivery_status"], m["bounce_type"] or "",
             "included" if m["included"] else "excluded", m["reason"]]
            for m in members if m["included"] or not only_eligible]
    return to_csv(["recipient_id", "name", "email", "campaign", "delivery_status", "bounce_type", "follow_up", "reason"], rows), len(rows)


def summary_csv(name: str, kpis: dict) -> str:
    rows = [[k, "" if v is None else v] for k, v in kpis.items()]
    return to_csv(["metric", "value"], [["campaign", name], *rows])


_ = select
