"""Deterministic bounce classification (no LLM)."""

BOUNCE_TYPES = ("hard_bounce", "soft_bounce", "invalid_email", "mailbox_unavailable", "domain_issue", "unknown")
BOUNCE_LABELS = {
    "hard_bounce": "Hard bounce",
    "soft_bounce": "Soft bounce",
    "invalid_email": "Invalid email",
    "mailbox_unavailable": "Mailbox unavailable",
    "domain_issue": "Domain issue",
    "unknown": "Other / unknown",
}
# Permanent failures: never eligible for a follow-up. Unknown is excluded conservatively.
PERMANENT = {"hard_bounce", "invalid_email", "domain_issue"}
RETRYABLE = {"soft_bounce", "mailbox_unavailable"}

_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("invalid_email", ("invalid address", "invalid email", "syntax", "malformed", "5.1.3")),
    ("domain_issue", ("domain", "dns", "no mx", "5.1.2", "host not found")),
    ("mailbox_unavailable", ("mailbox full", "over quota", "mailbox unavailable", "mailbox disabled", "inactive", "4.2.2", "5.2.1")),
    ("soft_bounce", ("temporar", "try again", "greylist", "deferred", "timeout", "4.0.0", "4.4.", "4.7.", "451", "421")),
    ("hard_bounce", ("5.1.1", "user unknown", "does not exist", "permanent", "rejected", "550")),
]


def classify_bounce(reason: str | None) -> str:
    text = (reason or "").lower()
    if not text.strip():
        return "unknown"
    for kind, needles in _RULES:
        if any(n in text for n in needles):
            return kind
    return "unknown"


def is_permanent(bounce_type: str | None) -> bool:
    return bounce_type in PERMANENT
