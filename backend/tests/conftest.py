import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.db import get_db, make_engine
from app.main import app
from app.models import Base


@pytest.fixture()
def db_session():
    engine = make_engine("sqlite://")
    Base.metadata.create_all(engine)
    S = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with S() as s:
        yield s


@pytest.fixture()
def client(db_session):
    def override():
        yield db_session

    app.dependency_overrides[get_db] = override
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c
    app.dependency_overrides.clear()


CONTACTS_CSV = """contact_id,first_name,last_name,email,audience,status,suppression_reason
C1,Ada,Lovelace,ada@example.com,Webinar,active,
C2,Bob,Stone,bob@example.com,Webinar,active,
C3,Cy,Dupe,ADA@example.com,Webinar,active,
C4,Dee,Bad,not-an-email,Webinar,active,
C5,Eve,Unsub,eve@example.com,Webinar,unsubscribed,asked to stop
C6,Fay,Supp,fay@example.com,Webinar,suppressed,complaint
C7,Gus,Four,gus@example.com,Webinar,active,
C8,Hal,Five,hal@example.com,Other,active,
"""


def upload(client, path, text, commit=True, name="x.csv", mapping=None):
    data = {"commit": "true" if commit else "false"}
    if mapping:
        import json

        data["mapping"] = json.dumps(mapping)
    return client.post(path, files={"file": (name, text.encode(), "text/csv")}, data=data)


@pytest.fixture()
def seeded(client):
    r = upload(client, "/api/import/contacts", CONTACTS_CSV)
    assert r.status_code == 200, r.text
    return client


def make_campaign(client, **over):
    body = {"name": "Spring Invite", "campaign_type": "invitation", "sender_name": "Events Team",
            "sender_email": "events@example.com", "subject": "Hi {{first_name}}", "preview_text": "Join us",
            "audience_name": "Webinar", "body_html": '<p>Hello {{first_name}}</p><a href="https://example.com/r">Go</a><a href="{{unsubscribe_url}}">u</a>'}
    body.update(over)
    r = client.post("/api/campaigns", json=body)
    assert r.status_code == 201, r.text
    return r.json()


_ = os
