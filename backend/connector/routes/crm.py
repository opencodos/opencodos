"""
CRM routes for the Atlas dashboard.
Provides contact management, pipeline views, and action items.
"""

from pathlib import Path

from .. import settings as _settings_mod
import yaml
from ..auth import require_api_key
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

router = APIRouter(prefix="/api/crm", tags=["crm"], dependencies=[Depends(require_api_key)])

# ==================== Configuration ====================


def _get_contacts_path() -> Path:
    """Get the contacts file path, respecting VAULT_PATH setting."""
    return _settings_mod.settings.get_vault_path() / "4 - CRM" / "contacts.yaml"


# ==================== Pydantic Models ====================


class LastMessages(BaseModel):
    me: str | None = None
    them: str | None = None


class Contact(BaseModel):
    id: str
    name: str
    company: str | None = None
    relationship: str | None = None
    hypothesis: str | None = None
    projects: list[str] = []
    category: str | None = None  # work, personal
    last_connection: str | None = None
    last_messages: LastMessages | None = None
    next_step: str | None = None
    telegram_id: int | None = None
    email: str | None = None
    interactions_365d: int = 0
    interactions_30d: int = 0
    sources: list[str] = []
    auto_created: bool = False
    profile_path: str | None = None
    health_score: int | None = None
    health_trend: str | None = None
    # CRM-specific fields (may not exist in all contacts)
    type: list[str] | None = None  # ["personal"] | ["client"] | ["investor"]
    deal_stage: str | None = None  # first_contact | call | negotiation | signed | stale | disqualified | closed_won | closed_lost
    deal_value: int | None = None


class ContactUpdate(BaseModel):
    # Existing CRM fields
    type: list[str] | None = None  # ["personal"] | ["client"] | ["investor"]
    deal_stage: str | None = None  # first_contact | call | negotiation | signed | stale | disqualified | closed_won | closed_lost
    deal_value: int | None = None
    # Core contact fields
    name: str | None = None
    relationship: str | None = None  # "5 - Very close", "4 - Close", etc.
    company: str | None = None
    next_step: str | None = None
    hypothesis: str | None = None
    email: str | None = None
    profile_path: str | None = None


class ContactListResponse(BaseModel):
    contacts: list[Contact]
    total: int


class PipelineStage(BaseModel):
    stage: str
    count: int
    total_value: int
    contacts: list[Contact]


class PipelineResponse(BaseModel):
    stages: list[PipelineStage]
    total_count: int
    total_value: int


class ActionItem(BaseModel):
    contact: Contact
    priority_score: int  # Computed score for sorting


class ActionItemsResponse(BaseModel):
    items: list[ActionItem]
    total: int


# ==================== Data Access ====================


def _load_contacts() -> dict:
    """Load contacts from YAML file."""
    contacts_path = _get_contacts_path()

    if not contacts_path.exists():
        raise HTTPException(status_code=404, detail=f"Contacts file not found at {contacts_path}")

    try:
        with open(contacts_path, encoding="utf-8") as f:
            data = yaml.safe_load(f)
        return data or {"contacts": [], "metadata": {}}
    except yaml.YAMLError as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse contacts YAML: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load contacts: {str(e)}")


def _save_contacts(data: dict) -> None:
    """Save contacts to YAML file."""
    contacts_path = _get_contacts_path()

    try:
        # Ensure parent directory exists
        contacts_path.parent.mkdir(parents=True, exist_ok=True)

        with open(contacts_path, "w", encoding="utf-8") as f:
            yaml.dump(data, f, allow_unicode=True, default_flow_style=False, sort_keys=False)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save contacts: {str(e)}")


def _contact_dict_to_model(contact_dict: dict) -> Contact:
    """Convert a contact dictionary to a Contact model."""
    # Handle last_messages which might be a dict or None
    last_messages = contact_dict.get("last_messages")
    if isinstance(last_messages, dict):
        last_messages = LastMessages(**last_messages)
    else:
        last_messages = None

    return Contact(
        id=contact_dict.get("id", ""),
        name=contact_dict.get("name", ""),
        company=contact_dict.get("company"),
        relationship=contact_dict.get("relationship"),
        hypothesis=contact_dict.get("hypothesis"),
        projects=contact_dict.get("projects", []) or [],
        category=contact_dict.get("category"),
        last_connection=str(contact_dict.get("last_connection")) if contact_dict.get("last_connection") else None,
        last_messages=last_messages,
        next_step=contact_dict.get("next_step"),
        telegram_id=contact_dict.get("telegram_id"),
        email=contact_dict.get("email"),
        interactions_365d=contact_dict.get("interactions_365d", 0) or 0,
        interactions_30d=contact_dict.get("interactions_30d", 0) or 0,
        sources=contact_dict.get("sources", []) or [],
        auto_created=contact_dict.get("auto_created", False),
        profile_path=contact_dict.get("profile_path"),
        health_score=contact_dict.get("health_score"),
        health_trend=contact_dict.get("health_trend"),
        type=contact_dict.get("type"),
        deal_stage=contact_dict.get("deal_stage"),
        deal_value=contact_dict.get("deal_value"),
    )


def _has_actionable_next_step(next_step: str | None) -> bool:
    """Check if next_step is actionable (not None-ish)."""
    if not next_step:
        return False

    next_step_lower = next_step.lower().strip()

    # Filter out "None" patterns
    if next_step_lower.startswith("none"):
        return False
    if next_step_lower.startswith("** none"):
        return False
    if next_step_lower.startswith("**none"):
        return False

    return True


def _get_relationship_tier(relationship: str | None) -> int:
    """Extract numeric tier from relationship string like '5 - Very close'."""
    if not relationship:
        return 0

    # Try to extract the number at the start
    try:
        parts = relationship.split(" - ")
        if parts:
            return int(parts[0])
    except (ValueError, IndexError):
        pass

    return 0


# ==================== Route Handlers ====================


@router.get("/contacts", response_model=list[Contact])
async def list_contacts(
    type: str | None = Query(None, description="Filter by type: personal, client, investor"),
    deal_stage: str | None = Query(None, description="Filter by deal stage"),
    has_next_step: bool | None = Query(None, description="Filter contacts with actionable next steps"),
    category: str | None = Query(None, description="Filter by category: work, personal"),
):
    """List all contacts with optional filters."""
    data = _load_contacts()
    contacts_list = data.get("contacts", [])

    result = []
    for contact_dict in contacts_list:
        contact = _contact_dict_to_model(contact_dict)

        # Apply filters
        if type is not None:
            contact_types = contact.type or []
            if type not in contact_types:
                continue

        if deal_stage is not None:
            if contact.deal_stage != deal_stage:
                continue

        if has_next_step is not None:
            has_action = _has_actionable_next_step(contact.next_step)
            if has_next_step and not has_action:
                continue
            if not has_next_step and has_action:
                continue

        if category is not None:
            if contact.category != category:
                continue

        result.append(contact)

    return result


@router.get("/contacts/{contact_id}", response_model=Contact)
async def get_contact(contact_id: str):
    """Get a single contact by ID with full profile."""
    data = _load_contacts()
    contacts_list = data.get("contacts", [])

    for contact_dict in contacts_list:
        if contact_dict.get("id") == contact_id:
            return _contact_dict_to_model(contact_dict)

    raise HTTPException(status_code=404, detail=f"Contact not found: {contact_id}")


@router.patch("/contacts/{contact_id}", response_model=Contact)
async def update_contact(contact_id: str, update: ContactUpdate):
    """Update a contact's CRM fields (type, deal_stage, deal_value)."""
    data = _load_contacts()
    contacts_list = data.get("contacts", [])

    # Find and update the contact
    contact_found = False
    updated_contact = None

    for i, contact_dict in enumerate(contacts_list):
        if contact_dict.get("id") == contact_id:
            contact_found = True

            # Apply updates (only update fields that are provided)
            if update.type is not None:
                contacts_list[i]["type"] = update.type
            if update.deal_stage is not None:
                contacts_list[i]["deal_stage"] = update.deal_stage
            if update.deal_value is not None:
                contacts_list[i]["deal_value"] = update.deal_value
            if update.name is not None:
                contacts_list[i]["name"] = update.name
            if update.relationship is not None:
                contacts_list[i]["relationship"] = update.relationship
            if update.company is not None:
                contacts_list[i]["company"] = update.company
            if update.next_step is not None:
                contacts_list[i]["next_step"] = update.next_step
            if update.hypothesis is not None:
                contacts_list[i]["hypothesis"] = update.hypothesis
            if update.email is not None:
                contacts_list[i]["email"] = update.email
            if update.profile_path is not None:
                contacts_list[i]["profile_path"] = update.profile_path

            # Save back to file
            data["contacts"] = contacts_list
            _save_contacts(data)

            updated_contact = _contact_dict_to_model(contacts_list[i])
            break

    if not contact_found:
        raise HTTPException(status_code=404, detail=f"Contact not found: {contact_id}")

    return updated_contact


@router.get("/pipeline", response_model=PipelineResponse)
async def get_pipeline():
    """Get pipeline summary - counts and totals by deal stage for clients/investors."""
    data = _load_contacts()
    contacts_list = data.get("contacts", [])

    # Define pipeline stages in order
    stage_order = ["to_connect", "first_contact", "call", "negotiation", "signed", "stale", "disqualified", "closed_won", "closed_lost"]
    stages_data = {stage: {"count": 0, "total_value": 0, "contacts": []} for stage in stage_order}

    # Also include unassigned stage for contacts without deal_stage
    stages_data["unassigned"] = {"count": 0, "total_value": 0, "contacts": []}

    for contact_dict in contacts_list:
        contact = _contact_dict_to_model(contact_dict)

        # Only include contacts that are clients or investors
        contact_types = contact.type or []
        is_deal_contact = "client" in contact_types or "investor" in contact_types

        if not is_deal_contact:
            continue

        stage = contact.deal_stage or "unassigned"
        if stage not in stages_data:
            stage = "unassigned"

        stages_data[stage]["count"] += 1
        stages_data[stage]["total_value"] += contact.deal_value or 0
        stages_data[stage]["contacts"].append(contact)

    # Build response
    stages = []
    total_count = 0
    total_value = 0

    for stage_name in stage_order + ["unassigned"]:
        stage_info = stages_data[stage_name]
        if stage_info["count"] > 0:  # Only include stages with contacts
            stages.append(
                PipelineStage(
                    stage=stage_name,
                    count=stage_info["count"],
                    total_value=stage_info["total_value"],
                    contacts=stage_info["contacts"],
                )
            )
            total_count += stage_info["count"]
            total_value += stage_info["total_value"]

    return PipelineResponse(stages=stages, total_count=total_count, total_value=total_value)


@router.get("/action-items", response_model=ActionItemsResponse)
async def get_action_items():
    """Get contacts needing follow-up, sorted by priority.

    Priority is based on:
    - deal_value (higher = higher priority)
    - relationship tier (higher = higher priority)
    - last_contact (older = higher priority)
    """
    data = _load_contacts()
    contacts_list = data.get("contacts", [])

    action_items = []

    for contact_dict in contacts_list:
        contact = _contact_dict_to_model(contact_dict)

        # Only include contacts with actionable next_step
        if not _has_actionable_next_step(contact.next_step):
            continue

        # Calculate priority score
        # Higher score = higher priority
        deal_value_score = (contact.deal_value or 0) // 1000  # Normalize by 1000
        relationship_score = _get_relationship_tier(contact.relationship) * 100

        # Last contact recency score (more negative days = higher priority)
        # We'll use a simple heuristic: if last_connection is None, highest priority
        recency_score = 0
        if contact.last_connection:
            # Simple: having any last_connection is better than none
            recency_score = -10
        else:
            recency_score = 50  # No contact info = high priority

        priority_score = deal_value_score + relationship_score + recency_score

        action_items.append(ActionItem(contact=contact, priority_score=priority_score))

    # Sort by priority_score descending
    action_items.sort(key=lambda x: x.priority_score, reverse=True)

    return ActionItemsResponse(items=action_items, total=len(action_items))
