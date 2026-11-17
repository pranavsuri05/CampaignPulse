from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer, field_validator

UTCDateTime = Annotated[datetime, PlainSerializer(lambda d: d.isoformat() + ("Z" if d.tzinfo is None else ""), return_type=str)]

CampaignType = Literal["invitation", "reminder", "announcement", "follow_up", "thank_you", "newsletter"]


def _strip(v: str | None) -> str | None:
    return v.strip() if isinstance(v, str) else v


class CampaignCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    campaign_type: CampaignType = "invitation"
    event_name: str | None = Field(default=None, max_length=200)
    sender_id: int | None = None
    sender_name: str | None = Field(default=None, max_length=200)
    sender_email: str | None = Field(default=None, max_length=320)
    subject: str | None = Field(default=None, max_length=998)
    preview_text: str | None = Field(default=None, max_length=500)
    audience_name: str | None = Field(default=None, max_length=200)
    body_html: str | None = Field(default=None, max_length=500_000)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name must not be blank")
        return v


class CampaignUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    campaign_type: CampaignType | None = None
    event_name: str | None = Field(default=None, max_length=200)
    sender_id: int | None = None
    sender_name: str | None = Field(default=None, max_length=200)
    sender_email: str | None = Field(default=None, max_length=320)
    subject: str | None = Field(default=None, max_length=998)
    preview_text: str | None = Field(default=None, max_length=500)
    audience_name: str | None = Field(default=None, max_length=200)
    body_html: str | None = Field(default=None, max_length=500_000)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            raise ValueError("name must not be blank")
        return v.strip() if v else v


class CampaignOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    campaign_type: str
    event_name: str | None
    status: str
    source: str
    sender_id: int | None
    sender_name: str | None
    sender_email: str | None
    subject: str | None
    preview_text: str | None
    audience_name: str | None
    body_html: str | None
    warnings_acknowledged: bool
    approved_at: UTCDateTime | None
    executed_at: UTCDateTime | None
    created_at: UTCDateTime
    updated_at: UTCDateTime


class ApproveIn(BaseModel):
    acknowledge_warnings: bool = False


class SenderIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    email: str = Field(min_length=3, max_length=320)
    is_default: bool = False


class SenderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    email: str
    is_default: bool


class RenderIn(BaseModel):
    html: str = Field(max_length=500_000)
    subject: str | None = None
    contact_id: int | None = None
    audience_name: str | None = None
    event_name: str | None = None
    campaign_name: str | None = None


class TemplateUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    subject: str | None = Field(default=None, max_length=998)
    body_html: str | None = Field(default=None, max_length=500_000)


class TemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    kind: str
    campaign_id: int | None
    segment: str | None
    subject: str
    body_html: str
    updated_at: UTCDateTime


class DraftIn(BaseModel):
    segment: str
