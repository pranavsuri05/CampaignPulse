from pathlib import Path

from tests.conftest import upload

SD = Path(__file__).resolve().parents[2] / "sample-data"


def test_sample_csvs_import_cleanly(client):
    j = upload(client, "/api/import/contacts", (SD / "contacts.csv").read_text())
    assert j.status_code == 200 and j.json()["imported_rows"] == 260 and j.json()["rejected_rows"] == 0
    s = j.json()["summary"]
    assert s["invalid_email"] == 8 and s["duplicate_email"] == 10 and s["unsubscribed"] == 15 and s["suppressed"] == 10
    r = upload(client, "/api/import/campaign-recipients", (SD / "campaign_recipients.csv").read_text()).json()
    assert r["rejected_rows"] == 0 and r["imported_rows"] == 360 and r["summary"]["campaigns_created"] == 3
    types = {x["key"] for x in client.get("/api/analytics").json()["bounce_reasons"]}
    assert types == {"hard_bounce", "soft_bounce", "invalid_email", "mailbox_unavailable", "domain_issue", "unknown"}
    assert {a["name"] for a in client.get("/api/audiences").json()["items"]} == {
        "All contacts", "Webinar Registrants", "Past Attendees", "Newsletter Subscribers"}
