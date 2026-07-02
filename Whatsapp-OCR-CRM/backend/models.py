"""Pydantic models for all collections.

We use MongoDB and store id as string (cuid-like). All datetimes are stored as ISO strings.
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import List, Optional, Literal, Any, Dict
from pydantic import BaseModel, Field, ConfigDict, EmailStr
import secrets
import string


def _gen_id() -> str:
    """Generate cuid-like id: c + 24 random alphanumeric."""
    alphabet = string.ascii_lowercase + string.digits
    return "c" + "".join(secrets.choice(alphabet) for _ in range(24))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


Role = Literal["ADMIN", "STAFF"]
EnquiryStatus = Literal["DRAFT", "REVIEW", "FINALIZED", "SENT"]
MessageDirection = Literal["INBOUND", "OUTBOUND"]
JobStatus = Literal["PENDING", "PROCESSING", "COMPLETED", "FAILED"]


class BaseDoc(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    id: str = Field(default_factory=_gen_id)


# ----- User -----
class User(BaseDoc):
    name: str
    email: str
    passwordHash: str
    role: Role = "STAFF"
    isActive: bool = True
    createdAt: str = Field(default_factory=_now)
    updatedAt: str = Field(default_factory=_now)


class UserPublic(BaseModel):
    id: str
    name: str
    email: str
    role: Role
    isActive: bool
    createdAt: str


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class CreateUserIn(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: Role = "STAFF"


class UpdateUserIn(BaseModel):
    name: Optional[str] = None
    role: Optional[Role] = None
    isActive: Optional[bool] = None


# ----- Customer -----
class Customer(BaseDoc):
    phone: str
    name: Optional[str] = None
    company: Optional[str] = None
    createdAt: str = Field(default_factory=_now)
    updatedAt: str = Field(default_factory=_now)


# ----- Conversation -----
class Conversation(BaseDoc):
    customerId: str
    waConversationId: str
    status: str = "open"
    lastMessageAt: str = Field(default_factory=_now)
    unreadCount: int = 0
    createdAt: str = Field(default_factory=_now)


# ----- WhatsappMessage -----
class WhatsappMessage(BaseDoc):
    conversationId: str
    direction: MessageDirection
    type: str  # text | image | document | template
    content: Optional[str] = None
    mediaUrl: Optional[str] = None
    waMessageId: Optional[str] = None
    deliveryStatus: Optional[str] = None  # sent | delivered | read | failed
    createdAt: str = Field(default_factory=_now)


# ----- Enquiry -----
class Enquiry(BaseDoc):
    conversationId: str
    customerId: str
    status: EnquiryStatus = "DRAFT"
    createdById: str
    finalizedAt: Optional[str] = None
    createdAt: str = Field(default_factory=_now)
    updatedAt: str = Field(default_factory=_now)


class EnquiryItem(BaseDoc):
    enquiryId: str
    inventoryId: Optional[str] = None
    rawText: Optional[str] = None
    productName: str
    qty: float
    unit: Optional[str] = None
    rate: Optional[float] = None
    confidence: float = 1.0
    matchType: Optional[str] = None  # exact | alias | fuzzy | new
    matchScore: Optional[float] = None
    createdAt: str = Field(default_factory=_now)
    updatedAt: str = Field(default_factory=_now)


class EnquiryItemIn(BaseModel):
    id: Optional[str] = None
    inventoryId: Optional[str] = None
    rawText: Optional[str] = None
    productName: str
    qty: float
    unit: Optional[str] = None
    rate: Optional[float] = None
    confidence: float = 1.0
    matchType: Optional[str] = None
    matchScore: Optional[float] = None


class CreateEnquiryIn(BaseModel):
    conversationId: str
    customerId: Optional[str] = None
    items: List[EnquiryItemIn] = []


class UpdateEnquiryIn(BaseModel):
    items: List[EnquiryItemIn]
    gstPercent: Optional[float] = None


# ----- Inventory -----
class Inventory(BaseDoc):
    name: str
    aliases: List[str] = []
    currentRate: Optional[float] = None
    unit: Optional[str] = None
    category: Optional[str] = None
    createdAt: str = Field(default_factory=_now)
    updatedAt: str = Field(default_factory=_now)


class CreateInventoryIn(BaseModel):
    name: str
    aliases: List[str] = []
    currentRate: Optional[float] = None
    unit: Optional[str] = None
    category: Optional[str] = None


class UpdateInventoryIn(BaseModel):
    name: Optional[str] = None
    aliases: Optional[List[str]] = None
    unit: Optional[str] = None
    category: Optional[str] = None


class UpdateRateIn(BaseModel):
    rate: float


class RateHistory(BaseDoc):
    inventoryId: str
    rate: float
    changedBy: Optional[str] = None
    recordedAt: str = Field(default_factory=_now)


# ----- Quotation -----
class Quotation(BaseDoc):
    enquiryId: str
    s3Key: str
    s3Url: str
    number: str
    gstPercent: float = 18.0
    subtotal: float = 0.0
    gstAmount: float = 0.0
    grandTotal: float = 0.0
    sentAt: Optional[str] = None
    createdAt: str = Field(default_factory=_now)


# ----- Automation -----
class AutomationRule(BaseDoc):
    name: str
    triggerType: str  # inquiry_followup | price_drop_alert | repeat_engagement | enquiry_reminder
    triggerParams: Dict[str, Any] = {}
    actionType: str  # send_template | log_only
    actionParams: Dict[str, Any] = {}
    isActive: bool = True
    createdAt: str = Field(default_factory=_now)
    updatedAt: str = Field(default_factory=_now)


class CreateRuleIn(BaseModel):
    name: str
    triggerType: str
    triggerParams: Dict[str, Any] = {}
    actionType: str = "send_template"
    actionParams: Dict[str, Any] = {}
    isActive: bool = True


class UpdateRuleIn(BaseModel):
    name: Optional[str] = None
    triggerType: Optional[str] = None
    triggerParams: Optional[Dict[str, Any]] = None
    actionType: Optional[str] = None
    actionParams: Optional[Dict[str, Any]] = None
    isActive: Optional[bool] = None


class ScheduledJob(BaseDoc):
    ruleId: str
    customerId: str
    scheduledAt: str
    status: JobStatus = "PENDING"
    payload: Dict[str, Any] = {}
    createdAt: str = Field(default_factory=_now)


# ----- ActivityLog -----
class ActivityLog(BaseDoc):
    userId: str
    action: str
    entityType: str
    entityId: Optional[str] = None
    createdAt: str = Field(default_factory=_now)


# ----- Webhook simulator payload (for MOCKED MSG91) -----
class SimulateInboundIn(BaseModel):
    phone: str
    name: Optional[str] = None
    type: Literal["text", "image"] = "text"
    content: Optional[str] = None
    # for image: a base64 data url or remote url; the server will store
    mediaDataUrl: Optional[str] = None
    mediaUrl: Optional[str] = None
