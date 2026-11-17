from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from app.db import utcnow


class Base(DeclarativeBase):
    pass


class SenderConfiguration(Base):
    __tablename__ = "sender_configurations"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(320), unique=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Campaign(Base):
    __tablename__ = "campaigns"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    campaign_type: Mapped[str] = mapped_column(String(40), default="invitation")
    event_name: Mapped[str | None] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)  # draft|approved|sent
    source: Mapped[str] = mapped_column(String(20), default="manual")  # manual|import
    sender_id: Mapped[int | None] = mapped_column(ForeignKey("sender_configurations.id", ondelete="SET NULL"))
    sender_name: Mapped[str | None] = mapped_column(String(200))
    sender_email: Mapped[str | None] = mapped_column(String(320))
    subject: Mapped[str | None] = mapped_column(String(998))
    preview_text: Mapped[str | None] = mapped_column(String(500))
    audience_name: Mapped[str | None] = mapped_column(String(200))
    body_html: Mapped[str | None] = mapped_column(Text)
    warnings_acknowledged: Mapped[bool] = mapped_column(Boolean, default=False)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime)
    executed_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    recipients: Mapped[list["CampaignRecipient"]] = relationship(
        back_populates="campaign", cascade="all, delete-orphan", passive_deletes=True
    )


class Contact(Base):
    __tablename__ = "contacts"
    id: Mapped[int] = mapped_column(primary_key=True)
    external_id: Mapped[str] = mapped_column(String(100), unique=True)
    first_name: Mapped[str] = mapped_column(String(255), default="")
    last_name: Mapped[str] = mapped_column(String(255), default="")
    email: Mapped[str] = mapped_column(String(320))
    email_normalized: Mapped[str] = mapped_column(String(320), index=True)
    audience: Mapped[str | None] = mapped_column(String(200), index=True)
    is_valid_email: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip() or self.email


class Suppression(Base):
    """Unsubscribe or suppression entry keyed by normalized email."""

    __tablename__ = "suppressions"
    __table_args__ = (UniqueConstraint("email_normalized", "kind"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    email_normalized: Mapped[str] = mapped_column(String(320), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # unsubscribed|suppressed
    reason: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class CampaignRecipient(Base):
    __tablename__ = "campaign_recipients"
    __table_args__ = (UniqueConstraint("campaign_id", "contact_id"), Index("ix_cr_campaign", "campaign_id"))
    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_id: Mapped[int] = mapped_column(ForeignKey("campaigns.id", ondelete="CASCADE"))
    contact_id: Mapped[int] = mapped_column(ForeignKey("contacts.id", ondelete="CASCADE"), index=True)
    eligibility: Mapped[str] = mapped_column(String(20), default="eligible")
    exclusion_reason: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    campaign: Mapped[Campaign] = relationship(back_populates="recipients")
    contact: Mapped[Contact] = relationship()
    delivery: Mapped["EmailDelivery | None"] = relationship(
        back_populates="recipient", uselist=False, cascade="all, delete-orphan", passive_deletes=True
    )


class EmailDelivery(Base):
    __tablename__ = "email_deliveries"
    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_recipient_id: Mapped[int] = mapped_column(
        ForeignKey("campaign_recipients.id", ondelete="CASCADE"), unique=True
    )
    status: Mapped[str] = mapped_column(String(20), index=True)  # delivered|bounced
    bounce_type: Mapped[str | None] = mapped_column(String(30), index=True)
    bounce_reason: Mapped[str | None] = mapped_column(String(500))
    provider: Mapped[str] = mapped_column(String(40), default="simulation")
    sent_at: Mapped[datetime] = mapped_column(DateTime, index=True)

    recipient: Mapped[CampaignRecipient] = relationship(back_populates="delivery")
    events: Mapped[list["CommunicationEvent"]] = relationship(cascade="all, delete-orphan", passive_deletes=True)


class CommunicationEvent(Base):
    __tablename__ = "communication_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    delivery_id: Mapped[int] = mapped_column(ForeignKey("email_deliveries.id", ondelete="CASCADE"), index=True)
    event_type: Mapped[str] = mapped_column(String(20))  # open|click
    occurred_at: Mapped[datetime] = mapped_column(DateTime)
    url: Mapped[str | None] = mapped_column(String(1000))


class EmailTemplate(Base):
    __tablename__ = "email_templates"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(30), default="followup_draft")
    campaign_id: Mapped[int | None] = mapped_column(ForeignKey("campaigns.id", ondelete="CASCADE"), index=True)
    segment: Mapped[str | None] = mapped_column(String(40))
    subject: Mapped[str] = mapped_column(String(998), default="")
    body_html: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


_ = Integer  # keep import for type tooling
