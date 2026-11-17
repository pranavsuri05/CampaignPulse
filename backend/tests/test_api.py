import csv
import io

import pytest
from sqlalchemy import func, select

from app.models import CampaignRecipient, CommunicationEvent, EmailDelivery
from tests.conftest import CONTACTS_CSV, make_campaign, upload


# ---------- health / errors ----------
def test_health_and_error_format(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and "Simulation Mode" in r.json()["message"]
    r = client.get("/api/campaigns/999")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    r = client.post("/api/campaigns", json={"name": ""})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"


# ---------- campaign CRUD ----------
def test_campaign_crud(client):
    c = make_campaign(client)
    assert c["status"] == "draft"
    assert client.get(f"/api/campaigns/{c['id']}").json()["name"] == "Spring Invite"
    r = client.patch(f"/api/campaigns/{c['id']}", json={"subject": "New subject"})
    assert r.status_code == 200 and r.json()["subject"] == "New subject"
    assert client.get("/api/campaigns").json()["total"] == 1
    assert client.delete(f"/api/campaigns/{c['id']}").status_code == 204
    assert client.get(f"/api/campaigns/{c['id']}").status_code == 404


def test_create_validation(client):
    assert client.post("/api/campaigns", json={"name": "x", "campaign_type": "bogus"}).status_code == 422
    assert client.post("/api/campaigns", json={"name": "   "}).status_code == 422
    assert client.post("/api/campaigns", json={"name": "x" * 201}).status_code == 422


# ---------- import ----------
def test_contacts_import_preview_then_commit(client):
    r = upload(client, "/api/import/contacts", CONTACTS_CSV, commit=False)
    j = r.json()
    assert r.status_code == 200 and j["dry_run"] and j["imported_rows"] == 0
    assert client.get("/api/audiences").json()["items"] == []  # nothing written by preview
    j = upload(client, "/api/import/contacts", CONTACTS_CSV).json()
    assert j["imported_rows"] == 8 and j["summary"]["invalid_email"] == 1 and j["summary"]["duplicate_email"] == 1
    assert j["summary"]["unsubscribed"] == 1 and j["summary"]["suppressed"] == 1
    assert {i["code"] for i in j["issues"]} == {"invalid_email", "duplicate_email"}
    # re-import is reported, not silently skipped, and creates nothing
    j2 = upload(client, "/api/import/contacts", CONTACTS_CSV).json()
    assert j2["imported_rows"] == 0 and j2["rejected_rows"] == 8
    assert all(i["code"] == "duplicate_contact_id" for i in j2["issues"])


@pytest.mark.parametrize("text,msg", [("", "empty"), ("   \n", "empty"), ("contact_id,first_name\nC1,A\n", "Missing required"),
                                      ("contact_id,contact_id,email\n1,2,a@example.com\n", "Duplicate column")])
def test_import_bad_files(client, text, msg):
    r = upload(client, "/api/import/contacts", text)
    assert r.status_code == 422 and msg.lower() in r.json()["error"]["message"].lower()


def test_import_rejects_wrong_type_binary_and_large(client, monkeypatch):
    assert upload(client, "/api/import/contacts", "a", name="x.exe").status_code == 422
    r = client.post("/api/import/contacts", files={"file": ("x.csv", b"a\x00b", "text/csv")})
    assert r.status_code == 422
    r = client.post("/api/import/contacts", files={"file": ("x.csv", b"a,b\n1,2\n", "image/png")})
    assert r.status_code == 422
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "max_upload_bytes", 10)
    assert upload(client, "/api/import/contacts", "contact_id,email\n" + "x" * 50).status_code == 413


def test_import_row_errors_reported(client):
    text = ("contact_id,email,first_name,last_name,status\nC1,a@example.com,A,B,active\n,b@example.com,A,B,active\n"
            f"C3,c@example.com,{'x' * 300},B,active\nC4,d@example.com,A,B,weird\nC5,e@example.com,A,B,active,extra,cols\n")
    j = upload(client, "/api/import/contacts", text).json()
    codes = sorted(i["code"] for i in j["issues"])
    assert codes == ["invalid_status", "missing_contact_id", "name_too_long", "too_many_columns"]
    assert j["imported_rows"] == 1 and j["rejected_rows"] == 4


def test_import_column_mapping(client):
    text = "ID,Mail,Given\nC1,a@example.com,Ann\n"
    j = upload(client, "/api/import/contacts", text, commit=False).json()
    assert j["missing_required"] == ["email"] and j["headers"] == ["ID", "Mail", "Given"]
    r = upload(client, "/api/import/contacts", "key,addr\nC1,a@example.com\n", mapping={"contact_id": "key", "email": "addr"})
    assert r.status_code == 200 and r.json()["imported_rows"] == 1


def test_long_names_are_stored(client):
    name = "L" * 255
    upload(client, "/api/import/contacts", f"contact_id,email,first_name\nC1,a@example.com,{name}\n")
    assert client.get("/api/recipients").json()["total"] == 0  # contacts are not recipients until campaign
    assert client.get("/api/audiences").status_code == 200


RECIPIENTS_CSV = """campaign_name,contact_id,delivery_status,bounce_type,bounce_reason,sent_at,opened_at,clicked_at,subject
Imp One,C1,delivered,,,2026-03-01T09:00:00,2026-03-01T10:00:00,2026-03-01T10:05:00,Hello
Imp One,C2,bounced,hard_bounce,550 5.1.1 user unknown,2026-03-01T09:00:00,,,Hello
Imp One,C7,delivered,,,2026-03-01T09:00:00,,,Hello
Imp One,C8,bounced,,Mailbox full,2026-03-01T09:00:00,,,Hello
Imp One,C6,not_sent,,,,,,Hello
"""


def test_campaign_recipient_import_and_diagnostics(seeded):
    c = seeded
    j = upload(c, "/api/import/campaign-recipients", RECIPIENTS_CSV).json()
    assert j["imported_rows"] == 5 and j["summary"]["campaigns_created"] == 1 and j["summary"]["deliveries"] == 4
    camp = c.get("/api/campaigns").json()["items"][0]
    assert camp["status"] == "sent" and camp["source"] == "import"
    a = c.get("/api/analytics").json()["kpis"]
    assert (a["attempted"], a["delivered"], a["bounced"], a["unique_opens"], a["unique_clicks"]) == (4, 2, 2, 1, 1)
    assert a["delivery_rate"] == 50.0 and a["open_rate"] == 50.0 and a["click_rate"] == 50.0
    reasons = {r["key"]: r["count"] for r in c.get("/api/analytics").json()["bounce_reasons"]}
    assert reasons == {"hard_bounce": 1, "mailbox_unavailable": 1}  # classified from reason text
    bounced = c.get("/api/recipients?delivery_status=bounced").json()
    assert bounced["total"] == 2
    assert c.get("/api/recipients?bounce_type=hard_bounce").json()["items"][0]["email"] == "bob@example.com"
    assert c.get("/api/recipients?q=bob").json()["total"] == 1
    assert c.get("/api/recipients?q=Ada Lovelace").json()["total"] == 1
    assert c.get("/api/recipients?q=%25").json()["total"] == 0  # wildcard is escaped
    assert c.get("/api/recipients?delivery_status=not_sent").json()["total"] == 1
    assert c.get("/api/recipients?engagement=clicked").json()["total"] == 1
    assert c.get("/api/recipients?engagement=unopened").json()["total"] == 1
    # bad rows reported
    bad = RECIPIENTS_CSV.replace("Imp One,C1,delivered", "Imp One,C99,delivered", 1)
    j = upload(c, "/api/import/campaign-recipients", bad).json()
    assert {i["code"] for i in j["issues"] if i["severity"] == "error"} >= {"unknown_contact", "duplicate_row"}


def test_recipients_sorting_pagination_detail(seeded):
    c = seeded
    upload(c, "/api/import/campaign-recipients", RECIPIENTS_CSV)
    p1 = c.get("/api/recipients?page_size=2&page=1&sort=email&order=asc").json()
    p2 = c.get("/api/recipients?page_size=2&page=2&sort=email&order=asc").json()
    assert p1["total"] == 5 and p1["pages"] == 3
    emails = [r["email"] for r in p1["items"] + p2["items"]]
    assert emails == sorted(emails, key=str.lower)
    desc = c.get("/api/recipients?sort=name&order=desc").json()["items"]
    assert desc[0]["name"] >= desc[-1]["name"]
    rid = c.get("/api/recipients?q=ada").json()["items"][0]["id"]
    d = c.get(f"/api/recipients/{rid}").json()
    assert d["delivery_status"] == "delivered" and [e["type"] for e in d["events"]] == ["open", "click"]
    assert c.get("/api/recipients/99999").status_code == 404
    assert c.get("/api/recipients?delivery_status=bogus").status_code == 422


# ---------- validation checklist ----------
def checks(client, cid):
    return {x["id"]: x for x in client.post(f"/api/campaigns/{cid}/validate").json()["checks"]}


def test_validation_audience_counts(seeded):
    c = make_campaign(seeded)
    v = seeded.post(f"/api/campaigns/{c['id']}/validate").json()
    a = v["audience"]
    assert a == {"total": 7, "eligible": 3, "invalid": 1, "duplicate": 1, "unsubscribed": 1, "suppressed": 1}
    assert v["blocking_count"] == 0 and v["can_approve"] and v["requires_acknowledgement"]
    assert v["readiness_score"] == 90 and "25" in v["score_rules"]
    ch = {x["id"]: x for x in v["checks"]}
    assert len(ch) == 14
    assert ch["invalid"]["severity"] == "warning" and ch["invalid"]["status"] == "fail" and ch["invalid"]["suggestion"]
    assert ch["duplicates"]["severity"] == "information"


@pytest.mark.parametrize("over,check_id", [
    ({"sender_name": ""}, "sender_name"), ({"sender_email": ""}, "sender_email_present"),
    ({"sender_email": "not-valid"}, "sender_email_valid"), ({"subject": ""}, "subject"),
    ({"audience_name": None}, "audience_exists"), ({"audience_name": "Nope"}, "audience_exists"),
    ({"body_html": ""}, "body"), ({"body_html": "<p>{{bogus}}</p>"}, "variables"),
    ({"audience_name": "Other"}, None), ({"preview_text": ""}, "preview_text"),
    ({"body_html": '<a href="#">x</a>'}, "links")])
def test_validation_failures(seeded, over, check_id):
    c = make_campaign(seeded, **over)
    ch = checks(seeded, c["id"])
    if check_id:
        assert ch[check_id]["status"] == "fail"
    else:
        assert ch["eligible"]["status"] == "pass"


def test_blocking_prevents_approval_and_execution(seeded):
    c = make_campaign(seeded, subject="")
    assert seeded.post(f"/api/campaigns/{c['id']}/approve", json={"acknowledge_warnings": True}).status_code == 422
    assert seeded.post(f"/api/campaigns/{c['id']}/execute").status_code == 409


def test_empty_audience_is_blocking(client):
    c = make_campaign(client)
    v = client.post(f"/api/campaigns/{c['id']}/validate").json()
    assert not v["can_approve"] and v["readiness_score"] < 100


def test_warning_needs_acknowledgement(seeded):
    c = make_campaign(seeded)
    r = seeded.post(f"/api/campaigns/{c['id']}/approve", json={})
    assert r.status_code == 422 and "acknowledged" in r.json()["error"]["message"]
    r = seeded.post(f"/api/campaigns/{c['id']}/approve", json={"acknowledge_warnings": True})
    assert r.status_code == 200 and r.json()["status"] == "approved"


def test_editing_approved_campaign_resets_approval(seeded):
    c = make_campaign(seeded)
    seeded.post(f"/api/campaigns/{c['id']}/approve", json={"acknowledge_warnings": True})
    r = seeded.patch(f"/api/campaigns/{c['id']}", json={"subject": "Changed"}).json()
    assert r["status"] == "draft" and r["approved_at"] is None
    assert seeded.post(f"/api/campaigns/{c['id']}/execute").status_code == 409


# ---------- preview is read-only ----------
def test_preview_read_only_and_content(seeded, db_session):
    c = make_campaign(seeded)
    before = seeded.get(f"/api/campaigns/{c['id']}").json()
    counts = db_session.scalar(select(func.count()).select_from(CampaignRecipient))
    for _ in range(3):
        p = seeded.get(f"/api/campaigns/{c['id']}/preview").json()
    assert p["sender"] == {"name": "Events Team", "email": "events@example.com"}
    assert p["subject"] == "Hi Ada" and p["sample_recipient"]["email"] == "ada@example.com"
    assert p["audience"]["eligible"] == 3 and "Hello Ada" in p["html"]
    assert seeded.get(f"/api/campaigns/{c['id']}").json() == before  # includes updated_at
    assert db_session.scalar(select(func.count()).select_from(CampaignRecipient)) == counts
    seeded.get(f"/api/campaigns/{c['id']}/preview?contact_id=2")


def test_preview_sanitizes_unsafe_html(seeded):
    c = make_campaign(seeded, body_html='<p>Hi</p><script>alert(1)</script><img src=x onerror=alert(2)>')
    html = seeded.get(f"/api/campaigns/{c['id']}/preview").json()["html"]
    assert "<script" not in html and "onerror" not in html and "Hi" in html
    r = seeded.post("/api/render", json={"html": "<script>x</script><b>ok</b>", "audience_name": "Webinar"})
    assert "<script" not in r.json()["html"] and "<b>ok</b>" in r.json()["html"]


# ---------- execution ----------
def run(client, **over):
    c = make_campaign(client, **over)
    assert client.post(f"/api/campaigns/{c['id']}/approve", json={"acknowledge_warnings": True}).status_code == 200
    return c


def test_execution_creates_records_and_excludes(seeded, db_session):
    c = run(seeded)
    r = seeded.post(f"/api/campaigns/{c['id']}/execute")
    assert r.status_code == 200 and r.json()["simulation"] and not r.json()["already_executed"]
    k = r.json()["kpis"]
    assert k["attempted"] == 3  # only eligible recipients
    rows = db_session.execute(select(CampaignRecipient.eligibility, func.count()).group_by(CampaignRecipient.eligibility)).all()
    assert dict(rows) == {"eligible": 3, "invalid": 1, "duplicate": 1, "unsubscribed": 1, "suppressed": 1}
    assert db_session.scalar(select(func.count()).select_from(EmailDelivery)) == 3
    assert seeded.get(f"/api/campaigns/{c['id']}").json()["status"] == "sent"
    # excluded recipients never receive a delivery
    ns = seeded.get(f"/api/recipients?campaign_id={c['id']}&delivery_status=not_sent").json()
    assert ns["total"] == 4 and {i["eligibility"] for i in ns["items"]} == {"invalid", "duplicate", "unsubscribed", "suppressed"}


def test_execution_idempotent(seeded, db_session):
    c = run(seeded)
    first = seeded.post(f"/api/campaigns/{c['id']}/execute").json()
    n = db_session.scalar(select(func.count()).select_from(EmailDelivery))
    e = db_session.scalar(select(func.count()).select_from(CommunicationEvent))
    for _ in range(3):
        again = seeded.post(f"/api/campaigns/{c['id']}/execute")
        assert again.status_code == 200 and again.json()["already_executed"] is True
        assert again.json()["kpis"] == first["kpis"]
    assert db_session.scalar(select(func.count()).select_from(EmailDelivery)) == n
    assert db_session.scalar(select(func.count()).select_from(CommunicationEvent)) == e
    assert seeded.patch(f"/api/campaigns/{c['id']}", json={"subject": "x"}).status_code == 409
    assert seeded.post(f"/api/campaigns/{c['id']}/approve", json={"acknowledge_warnings": True}).status_code == 409


def test_simulation_reproducible_across_campaigns(seeded):
    def outcome(cid):
        return sorted((r["email"], r["delivery_status"], r["bounce_type"], r["opened"], r["clicked"])
                      for r in seeded.get(f"/api/recipients?campaign_id={cid}&page_size=200").json()["items"])
    a = run(seeded, name="Same Name")
    seeded.post(f"/api/campaigns/{a['id']}/execute")
    first = outcome(a["id"])
    seeded.delete(f"/api/campaigns/{a['id']}")
    b = run(seeded, name="Same Name")
    seeded.post(f"/api/campaigns/{b['id']}/execute")
    assert outcome(b["id"]) == first


def test_execute_unapproved_conflict(seeded):
    c = make_campaign(seeded)
    assert seeded.post(f"/api/campaigns/{c['id']}/execute").status_code == 409


def test_suppression_excluded_even_if_audience_all(seeded, db_session):
    c = run(seeded, audience_name="All contacts")
    seeded.post(f"/api/campaigns/{c['id']}/execute")
    sent_to = {r["email"] for r in seeded.get(f"/api/recipients?campaign_id={c['id']}&page_size=200").json()["items"] if r["delivery_status"] != "not_sent"}
    assert "eve@example.com" not in sent_to and "fay@example.com" not in sent_to and "not-an-email" not in sent_to
    assert {"ada@example.com", "hal@example.com"} <= sent_to


# ---------- analytics ----------
def test_analytics_filters_change_data(seeded):
    c = run(seeded, audience_name="All contacts")
    seeded.post(f"/api/campaigns/{c['id']}/execute")
    allk = seeded.get(f"/api/campaigns/{c['id']}/analytics").json()
    assert allk["kpis"]["attempted"] == 4 and allk["registrations"] is None
    one = seeded.get(f"/api/campaigns/{c['id']}/analytics?domain=nonexistent.com").json()
    assert one["kpis"]["attempted"] == 0 and one["kpis"]["delivery_rate"] is None
    ex = seeded.get(f"/api/campaigns/{c['id']}/analytics?domain=example.com").json()
    assert ex["kpis"]["attempted"] == 4
    far = seeded.get(f"/api/campaigns/{c['id']}/analytics?date_from=2000-01-01&date_to=2000-01-02").json()
    assert far["kpis"]["attempted"] == 0
    assert seeded.get("/api/campaigns/999/analytics").status_code == 404
    assert sum(x["count"] for x in allk["status_breakdown"]) == 4


def test_zero_delivery_campaign(seeded):
    # a campaign whose every recipient bounced
    text = "campaign_name,contact_id,delivery_status,bounce_type,bounce_reason,sent_at\nBad,C1,bounced,hard_bounce,x,2026-03-01T09:00:00\n"
    upload(seeded, "/api/import/campaign-recipients", text)
    cid = seeded.get("/api/campaigns").json()["items"][0]["id"]
    k = seeded.get(f"/api/campaigns/{cid}/analytics").json()["kpis"]
    assert k["delivered"] == 0 and k["delivery_rate"] == 0.0 and k["open_rate"] is None and k["click_rate"] is None


# ---------- follow-ups ----------
FU = """campaign_name,contact_id,delivery_status,bounce_type,bounce_reason,sent_at,opened_at,clicked_at
F,C1,delivered,,,2026-03-01T09:00:00,,
F,C2,delivered,,,2026-03-01T09:00:00,2026-03-01T10:00:00,
F,C5,delivered,,,2026-03-01T09:00:00,,
F,C6,delivered,,,2026-03-01T09:00:00,2026-03-01T10:00:00,2026-03-01T10:01:00
F,C7,bounced,soft_bounce,try again,2026-03-01T09:00:00,,
F,C8,bounced,hard_bounce,user unknown,2026-03-01T09:00:00,,
"""


def test_followup_segments_and_exclusions(seeded):
    upload(seeded, "/api/import/campaign-recipients", FU)
    cid = seeded.get("/api/campaigns").json()["items"][0]["id"]
    segs = {s["key"]: s for s in seeded.get(f"/api/campaigns/{cid}/followups").json()["segments"]}
    un = {m["email"]: m for m in segs["unopened"]["members"]}
    assert un["ada@example.com"]["included"] and not un["eve@example.com"]["included"]
    assert "unsubscribed" in un["eve@example.com"]["reason"]
    b = {m["email"]: m for m in segs["bounced"]["members"]}
    assert b["gus@example.com"]["included"] and not b["hal@example.com"]["included"]
    assert "permanent" in b["hal@example.com"]["reason"]
    assert segs["opened_not_clicked"]["total"] == 1 and segs["opened_not_clicked"]["eligible"] == 1
    r = seeded.get(f"/api/campaigns/{cid}/followups/export?segment=unopened")
    rows = list(csv.DictReader(io.StringIO(r.text)))
    assert [x["email"] for x in rows] == ["ada@example.com"] and r.headers["x-row-count"] == "1"
    full = list(csv.DictReader(io.StringIO(seeded.get(f"/api/campaigns/{cid}/followups/export?segment=unopened&include_excluded=true").text)))
    assert {x["follow_up"] for x in full} == {"included", "excluded"}
    assert seeded.get(f"/api/campaigns/{cid}/followups/export?segment=zzz").status_code == 404


def test_followup_draft_edit_preview(seeded):
    upload(seeded, "/api/import/campaign-recipients", FU.replace("F,", "Camp,"))
    cid = seeded.get("/api/campaigns").json()["items"][0]["id"]
    d = seeded.post(f"/api/campaigns/{cid}/followups/draft", json={"segment": "unopened"}).json()
    assert "{{first_name}}" in d["body_html"] and d["segment"] == "unopened"
    again = seeded.post(f"/api/campaigns/{cid}/followups/draft", json={"segment": "unopened"}).json()
    assert again["id"] == d["id"]
    u = seeded.patch(f"/api/templates/{d['id']}", json={"subject": "Edited", "body_html": "<p>Yo {{first_name}}</p><script>1</script>"}).json()
    assert u["subject"] == "Edited"
    p = seeded.get(f"/api/templates/{d['id']}/preview").json()
    assert "Yo Alex" in p["html"] and "<script" not in p["html"]
    assert seeded.post(f"/api/campaigns/{cid}/followups/draft", json={"segment": "nope"}).status_code == 422
    # nothing was sent
    assert seeded.get(f"/api/campaigns/{cid}").json()["status"] == "sent"


# ---------- exports ----------
def test_export_respects_filters_and_neutralizes_formulas(client):
    text = ("contact_id,first_name,last_name,email,audience,status\n"
            "C1,=HYPERLINK(\"http://x\"),Evil,a@example.com,L,active\nC2,Ok,Person,b@example.com,L,suppressed\n")
    upload(client, "/api/import/contacts", text)
    rec = ("campaign_name,contact_id,delivery_status,bounce_type,bounce_reason,sent_at\n"
           "E,C1,bounced,hard_bounce,=cmd|' /C calc'!A0,2026-03-01T09:00:00\nE,C2,bounced,hard_bounce,x,2026-03-01T09:00:00\n")
    upload(client, "/api/import/campaign-recipients", rec)
    r = client.get("/api/exports/recipients?delivery_status=bounced")
    assert r.headers["content-type"].startswith("text/csv") and r.headers["x-row-count"] == "2"
    rows = list(csv.DictReader(io.StringIO(r.text)))
    assert rows[0]["bounce_reason"].startswith("'=") or rows[1]["bounce_reason"].startswith("'=")
    assert all(not v.startswith("=") for row in rows for v in row.values())
    r = client.get("/api/exports/recipients?delivery_status=bounced&exclude_suppressed=true")
    assert r.headers["x-row-count"] == "1"
    assert client.get("/api/exports/recipients?q=b@example").headers["x-row-count"] == "1"
    cid = client.get("/api/campaigns").json()["items"][0]["id"]
    s = client.get(f"/api/exports/campaigns/{cid}/summary")
    assert "delivery_rate" in s.text


# ---------- senders ----------
def test_senders(client):
    assert client.post("/api/settings/senders", json={"name": "A", "email": "bad"}).status_code == 422
    r = client.post("/api/settings/senders", json={"name": "Team", "email": "Team@Example.com", "is_default": True})
    assert r.status_code == 201 and r.json()["email"] == "team@example.com"
    assert client.post("/api/settings/senders", json={"name": "Team", "email": "team@example.com"}).status_code == 409
    sid = r.json()["id"]
    c = client.post("/api/campaigns", json={"name": "X", "sender_id": sid}).json()
    assert c["sender_email"] == "team@example.com" and c["sender_name"] == "Team"
    assert client.post("/api/campaigns", json={"name": "X", "sender_id": 999}).status_code == 422
    assert len(client.get("/api/settings/senders").json()) == 1


# ---------- auth ----------
def test_api_key_guard(client, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "api_key", "secret")
    assert client.post("/api/campaigns", json={"name": "x"}).status_code == 401
    assert client.get("/api/campaigns").status_code == 200
    assert client.post("/api/campaigns", json={"name": "x"}, headers={"X-API-Key": "secret"}).status_code == 201
    assert client.delete("/api/campaigns/1").status_code == 401


def test_unhandled_error_is_safe(client, monkeypatch):
    from app.services import analytics

    monkeypatch.setattr(analytics, "overview", lambda s: 1 / 0)
    import app.routers.data as d

    monkeypatch.setattr(d.an, "overview", lambda s: 1 / 0)
    r = client.get("/api/overview")
    assert r.status_code == 500 and "division" not in r.text and r.json()["error"]["code"] == "internal_error"


def test_migrations_apply_cleanly(tmp_path):
    import os
    import sqlite3
    import subprocess
    import sys

    db = tmp_path / "m.db"
    env = {**os.environ, "ALEMBIC_DATABASE_URL": f"sqlite:///{db}"}
    r = subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], capture_output=True, text=True, env=env)
    assert r.returncode == 0, r.stderr
    tables = {t for (t,) in sqlite3.connect(db).execute("select name from sqlite_master where type='table'")}
    assert {"campaigns", "contacts", "campaign_recipients", "email_deliveries", "communication_events",
            "suppressions", "email_templates", "sender_configurations"} <= tables
