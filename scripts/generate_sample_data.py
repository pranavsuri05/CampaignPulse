#!/usr/bin/env python3
"""Regenerate sample-data/*.csv deterministically (fictional people, example.com addresses only)."""
import csv
import random
from datetime import datetime, timedelta
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "sample-data"
rng = random.Random(20261117)
FIRST = "Aarav Maya Liam Noor Ethan Zoe Kai Isla Omar Lena Noah Aisha Mateo Priya Jonas Sofia Dev Hana Rafael Tara Elio Mina Arjun Clara Yusuf Nia Felix Rhea Theo Amara Ivan Leila Marco Sana Owen Vera Hugo Anika Dario".split()
LAST = "Rivera Nakamura Okafor Lindqvist Banerjee Moreau Castillo Haddad Petrov Alvarez Tanaka Oyelaran Schmidt Kowalski Mehta Duarte Fontaine Ibrahim Larsen Osei Park Quinn Rossi Sato Varga Walsh Xu Young Zhang Abara".split()
AUDIENCES = [("Webinar Registrants", 110), ("Past Attendees", 80), ("Newsletter Subscribers", 60)]

contacts, n = [], 0
for aud, count in AUDIENCES:
    for _ in range(count):
        n += 1
        f, l = rng.choice(FIRST), rng.choice(LAST)
        contacts.append({"contact_id": f"C{n:04d}", "first_name": f, "last_name": l,
                         "email": f"{f}.{l}.{n}@example.com".lower(), "audience": aud, "status": "active", "suppression_reason": ""})
idx = list(range(len(contacts)))
rng.shuffle(idx)
for i in idx[:15]:
    contacts[i].update(status="unsubscribed", suppression_reason=rng.choice(["Clicked unsubscribe", "Replied STOP", "Preference centre"]))
for i in idx[15:25]:
    contacts[i].update(status="suppressed", suppression_reason=rng.choice(["Spam complaint", "Manual suppression", "Legal request"]))
for i in idx[25:33]:  # invalid addresses
    contacts[i]["email"] = rng.choice(["{}.example.com", "{}@", "{}@@example.com", "{}@example", "{} @example.com"]).format(contacts[i]["first_name"].lower())
for i in idx[33:43]:  # duplicate emails under new contact ids
    src = contacts[idx[100 + (i % 50)]]
    n += 1
    contacts.append({"contact_id": f"C{n:04d}", "first_name": src["first_name"], "last_name": src["last_name"], "email": src["email"].upper(),
                     "audience": src["audience"], "status": "active", "suppression_reason": ""})
contacts[idx[50]]["last_name"] = "Von " + "Longsurname-" * 8 + "Smith"  # very long name

with open(OUT / "contacts.csv", "w", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=list(contacts[0]))
    w.writeheader()
    w.writerows(contacts)

CAMPAIGNS = [
    ("Spring Summit — Save the Date", "invitation", "Save the date: Spring Summit 2026", datetime(2026, 9, 1, 9, 0), ["Webinar Registrants", "Newsletter Subscribers"]),
    ("Spring Summit — Final Reminder", "reminder", "Tomorrow: your Spring Summit access link", datetime(2026, 9, 20, 8, 30), ["Webinar Registrants"]),
    ("Spring Summit — Thank You", "thank_you", "Thanks for joining — recordings inside", datetime(2026, 10, 5, 16, 0), ["Past Attendees"]),
]
BOUNCES = [("hard_bounce", "550 5.1.1 User unknown"), ("hard_bounce", "550 5.1.1 Mailbox does not exist"),
           ("soft_bounce", "451 4.7.1 Temporary failure, try again later"), ("soft_bounce", "421 4.4.2 Connection timeout"),
           ("mailbox_unavailable", "552 5.2.2 Mailbox full / over quota"), ("domain_issue", "550 5.1.2 Domain not found (DNS lookup failed)"),
           ("unknown", "")]
rows = []
for name, ctype, subject, sent, auds in CAMPAIGNS:
    seen = set()
    for c in contacts:
        if c["audience"] not in auds:
            continue
        base = dict(campaign_name=name, campaign_type=ctype, subject=subject, sender_name="Summit Events Team",
                    sender_email="events@example.com", contact_id=c["contact_id"], bounce_type="", bounce_reason="",
                    sent_at=sent.isoformat(), opened_at="", clicked_at="")
        email = c["email"].lower()
        if c["status"] != "active":
            rows.append({**base, "delivery_status": "not_sent", "sent_at": ""})
            continue
        if "@" not in email or email.count("@") != 1 or " " in email or "." not in email.split("@")[-1]:
            rows.append({**base, "delivery_status": "bounced", "bounce_type": "invalid_email", "bounce_reason": "Invalid address syntax"})
            continue
        if email in seen:
            continue
        seen.add(email)
        if rng.random() < 0.14:
            bt, reason = rng.choice(BOUNCES)
            rows.append({**base, "delivery_status": "bounced", "bounce_type": bt, "bounce_reason": reason})
            continue
        r = {**base, "delivery_status": "delivered"}
        if rng.random() < 0.46:
            o = sent + timedelta(minutes=rng.randint(2, 2800))
            r["opened_at"] = o.isoformat()
            if rng.random() < 0.3:
                r["clicked_at"] = (o + timedelta(minutes=rng.randint(1, 90))).isoformat()
        rows.append(r)
FIELDS = ["campaign_name", "campaign_type", "subject", "sender_name", "sender_email", "contact_id", "delivery_status",
          "bounce_type", "bounce_reason", "sent_at", "opened_at", "clicked_at"]
with open(OUT / "campaign_recipients.csv", "w", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=FIELDS)
    w.writeheader()
    w.writerows(rows)
print(f"contacts: {len(contacts)}  campaign_recipient rows: {len(rows)}")
