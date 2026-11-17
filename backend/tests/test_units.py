from datetime import datetime

import pytest

from app.services.bounce import classify_bounce
from app.services.emailutil import (
    csv_safe,
    invalid_links,
    is_valid_email,
    render_document,
    sanitize_html,
    unsupported_variables,
)
from app.services.metrics import build_insights, campaign_health, compute_kpis, rate
from app.services.provider import OutboundMessage, SimulationEmailProvider


@pytest.mark.parametrize("e,ok", [("a@example.com", True), ("a.b+c@sub.example.co", True), ("", False), ("a@b", False),
                                  ("no-at.example.com", False), ("a..b@example.com", False), ("a b@example.com", False), (None, False)])
def test_email_validation(e, ok):
    assert is_valid_email(e) is ok


@pytest.mark.parametrize("reason,expected", [
    ("550 5.1.1 user unknown", "hard_bounce"), ("451 4.7.1 try again later", "soft_bounce"),
    ("Mailbox full", "mailbox_unavailable"), ("DNS lookup failed for domain", "domain_issue"),
    ("Invalid address syntax", "invalid_email"), ("", "unknown"), (None, "unknown"), ("weird", "unknown")])
def test_bounce_classification(reason, expected):
    assert classify_bounce(reason) == expected


def test_rates_and_zero_denominators():
    assert rate(1, 0) is None
    assert rate(1, 4) == 25.0
    k = compute_kpis(0, 0, 0, 0, 0)
    assert k["delivery_rate"] is None and k["open_rate"] is None and k["click_rate"] is None
    k = compute_kpis(100, 90, 10, 45, 9)
    assert (k["delivery_rate"], k["bounce_rate"], k["open_rate"], k["click_rate"]) == (90.0, 10.0, 50.0, 10.0)


def test_zero_delivered_zero_opens_zero_clicks():
    k = compute_kpis(10, 0, 10, 0, 0)
    assert k["delivery_rate"] == 0.0 and k["open_rate"] is None and k["click_rate"] is None
    k = compute_kpis(10, 10, 0, 0, 0)
    assert k["open_rate"] == 0.0 and k["click_rate"] == 0.0


def test_health_and_insights_from_metrics():
    assert campaign_health(compute_kpis(100, 85, 15, 0, 0))["level"] == "bad"
    assert campaign_health(compute_kpis(100, 94, 6, 0, 0))["level"] == "warn"
    assert campaign_health(compute_kpis(100, 99, 1, 0, 0))["level"] == "good"
    msgs = " ".join(i["message"] for i in build_insights(compute_kpis(100, 80, 20, 10, 1)))
    assert "Delivery failures are elevated" in msgs
    assert "different subject line" in msgs
    msgs = " ".join(i["message"] for i in build_insights(compute_kpis(100, 100, 0, 60, 5)))
    assert "call to action" in msgs
    assert build_insights(compute_kpis(0, 0, 0, 0, 0))[0]["title"] == "No sent emails yet"


def test_sanitizer_removes_unsafe_html():
    dirty = '<p onclick="x()">Hi</p><script>alert(1)</script><img src="x" onerror="alert(2)"><a href="javascript:alert(3)">l</a><iframe src="//e"></iframe><style>p{}</style>'
    clean = sanitize_html(dirty)
    for bad in ("<script", "onerror", "onclick", "javascript:", "<iframe", "<style", "alert(1)"):
        assert bad not in clean
    assert "Hi" in clean


def test_personalization_escapes_values():
    out = render_document("<p>{{first_name}}</p>", {"first_name": "<script>x</script>"})
    assert "<script>x" not in out and "&lt;script&gt;" in out
    assert "Content-Security-Policy" in out


def test_variables_and_links():
    assert unsupported_variables("{{first_name}} {{ bogus }}", "{{nope}}") == ["bogus", "nope"]
    assert invalid_links('<a href="https://example.com/a">x</a><a href="{{unsubscribe_url}}">u</a>') == []
    bad = invalid_links('<a href="#">x</a><a href="http://">y</a><a href="javascript:1">z</a><a href="">e</a>')
    assert len(bad) == 4


@pytest.mark.parametrize("v", ["=SUM(A1)", "+1", "-2", "@cmd", "\tx"])
def test_csv_formula_injection(v):
    assert csv_safe(v).startswith("'")
    assert csv_safe("normal") == "normal" and csv_safe(None) == ""


def test_simulation_is_deterministic_and_varied():
    p = SimulationEmailProvider()
    now = datetime(2026, 1, 1)
    msg = lambda i: OutboundMessage("C", "s@example.com", f"u{i}@example.com", "s", "h", now)  # noqa: E731
    a = [(o.status, o.bounce_type, [e.event_type for e in o.events]) for o in (p.send(msg(i)) for i in range(300))]
    b = [(o.status, o.bounce_type, [e.event_type for e in o.events]) for o in (p.send(msg(i)) for i in range(300))]
    assert a == b
    statuses = {x[0] for x in a}
    assert statuses == {"delivered", "bounced"}
    assert {x[1] for x in a if x[0] == "bounced"} >= {"hard_bounce", "soft_bounce"}
    assert any("click" in x[2] for x in a) and any(x[2] == [] for x in a if x[0] == "delivered")


def test_relative_sqlite_path_resolves_against_backend_dir():
    from app.config import BACKEND_DIR, Settings

    assert Settings(database_url="sqlite:///./data/x.db").database_url == f"sqlite:///{BACKEND_DIR / 'data' / 'x.db'}"
    assert Settings(database_url="sqlite:////abs/x.db").database_url == "sqlite:////abs/x.db"
    assert Settings(database_url="postgresql+psycopg://u:p@h/db").database_url.startswith("postgresql")
