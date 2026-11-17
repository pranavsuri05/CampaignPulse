"""EmailProvider abstraction and the deterministic SimulationEmailProvider.

No real email is ever sent by this module. A real provider (SES, SendGrid, SMTP, ...) can be added by
implementing EmailProvider.send and registering it in get_provider().
"""
import hashlib
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from app.config import get_settings


@dataclass
class OutboundMessage:
    campaign_name: str
    sender_email: str
    to_email: str
    subject: str
    html: str
    sent_at: datetime


@dataclass
class EventOutcome:
    event_type: str  # open|click
    occurred_at: datetime
    url: str | None = None


@dataclass
class DeliveryOutcome:
    status: str  # delivered|bounced
    bounce_type: str | None = None
    bounce_reason: str | None = None
    events: list[EventOutcome] = field(default_factory=list)


class EmailProvider(ABC):
    name: str
    is_simulation: bool = False

    @abstractmethod
    def send(self, message: OutboundMessage) -> DeliveryOutcome: ...


_BOUNCES = [
    ("hard_bounce", "550 5.1.1 Recipient address rejected: user unknown (simulated)"),
    ("soft_bounce", "451 4.7.1 Temporary failure, try again later (simulated)"),
    ("mailbox_unavailable", "552 5.2.2 Mailbox full / over quota (simulated)"),
    ("domain_issue", "550 5.1.2 Domain not found: DNS lookup failed (simulated)"),
    ("unknown", None),
]


def _bucket(key: str, salt: str, mod: int = 100) -> int:
    return int(hashlib.sha256(f"{salt}|{key}".encode()).hexdigest()[:12], 16) % mod


class SimulationEmailProvider(EmailProvider):
    """Deterministic: the same campaign name + address always yields the same outcome."""

    name = "simulation"
    is_simulation = True

    def send(self, m: OutboundMessage) -> DeliveryOutcome:
        key = f"{m.campaign_name}|{m.to_email.lower()}"
        r = _bucket(key, "outcome")
        # 0-83 delivered (84%); 84-87 hard; 88-91 soft; 92-94 mailbox; 95-96 domain; 97-99 unknown
        if r >= 84:
            idx = 0 if r < 88 else 1 if r < 92 else 2 if r < 95 else 3 if r < 97 else 4
            btype, reason = _BOUNCES[idx]
            return DeliveryOutcome("bounced", btype, reason)
        events: list[EventOutcome] = []
        if _bucket(key, "open") < 48:
            opened_at = m.sent_at + timedelta(minutes=1 + _bucket(key, "open_t", 2000))
            events.append(EventOutcome("open", opened_at))
            if _bucket(key, "click") < 32:
                events.append(EventOutcome("click", opened_at + timedelta(minutes=1 + _bucket(key, "click_t", 120)),
                                           "https://example.com/register"))
        return DeliveryOutcome("delivered", events=events)


def get_provider() -> EmailProvider:
    name = get_settings().email_provider
    if name == "simulation":
        return SimulationEmailProvider()
    raise RuntimeError(f"Unsupported EMAIL_PROVIDER '{name}'. Only 'simulation' is implemented.")
