"""REST API for agent configuration CRUD.

Provides endpoints to list, read, create, update, and delete agent
configs from the repo (codos/agents/) and memory from the Vault.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..auth import require_api_key
from ..services.agent_loader import (
    AgentConfig,
    _load_memory,
    _resolve_agent_id,
    delete_agent,
    list_agents,
    parse_agent,
    replace_memory,
    save_agent,
)

router = APIRouter(
    prefix="/api/agents/config",
    tags=["agents-config"],
    dependencies=[Depends(require_api_key)],
)


# ==================== Pydantic Models ====================


class AgentSummary(BaseModel):
    id: str
    name: str
    role: str
    icon: str
    color: str
    skills: list[str]


class AgentDetail(BaseModel):
    id: str
    name: str
    role: str
    icon: str
    color: str
    skills: list[str]
    permissions: list[str]
    prompt: str
    memory: str


class AgentListResponse(BaseModel):
    agents: list[AgentSummary]


class CreateAgentRequest(BaseModel):
    id: str
    name: str
    role: str
    icon: str = "bot"
    color: str = "#6B7280"
    skills: list[str] = []
    permissions: list[str] = []
    prompt: str = ""


class UpdateAgentRequest(BaseModel):
    name: str | None = None
    role: str | None = None
    icon: str | None = None
    color: str | None = None
    skills: list[str] | None = None
    permissions: list[str] | None = None
    prompt: str | None = None


class MemoryResponse(BaseModel):
    agent_id: str
    entries: list[str]


class ReplaceMemoryRequest(BaseModel):
    content: str


# ==================== Route Handlers ====================


@router.get("", response_model=AgentListResponse)
async def get_agents():
    """List all agents (summary: id, name, role, icon, color, skills)."""
    agents = list_agents()
    return AgentListResponse(
        agents=[
            AgentSummary(
                id=a.id,
                name=a.name,
                role=a.role,
                icon=a.icon,
                color=a.color,
                skills=a.skills,
            )
            for a in agents
        ]
    )


@router.get("/{agent_id}", response_model=AgentDetail)
async def get_agent(agent_id: str):
    """Get full agent detail including prompt and memory."""
    config = parse_agent(agent_id)
    if not config:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")

    return AgentDetail(
        id=config.id,
        name=config.name,
        role=config.role,
        icon=config.icon,
        color=config.color,
        skills=config.skills,
        permissions=config.permissions,
        prompt=config.prompt,
        memory="\n".join(config.memory),
    )


@router.post("", response_model=AgentDetail, status_code=201)
async def create_agent(request: CreateAgentRequest):
    """Create a new agent (writes folder + prompt.md, creates empty memory)."""
    # Check if agent already exists
    existing = parse_agent(request.id)
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Agent '{request.id}' already exists",
        )

    config = AgentConfig(
        id=request.id,
        name=request.name,
        role=request.role,
        icon=request.icon,
        color=request.color,
        skills=request.skills,
        permissions=request.permissions,
        prompt=request.prompt,
    )

    save_agent(config)

    return AgentDetail(
        id=config.id,
        name=config.name,
        role=config.role,
        icon=config.icon,
        color=config.color,
        skills=config.skills,
        permissions=config.permissions,
        prompt=config.prompt,
        memory="",
    )


@router.put("/{agent_id}", response_model=AgentDetail)
async def update_agent(agent_id: str, request: UpdateAgentRequest):
    """Update an existing agent's config."""
    config = parse_agent(agent_id)
    if not config:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")

    # Apply updates
    if request.name is not None:
        config.name = request.name
    if request.role is not None:
        config.role = request.role
    if request.icon is not None:
        config.icon = request.icon
    if request.color is not None:
        config.color = request.color
    if request.skills is not None:
        config.skills = request.skills
    if request.permissions is not None:
        config.permissions = request.permissions
    if request.prompt is not None:
        config.prompt = request.prompt

    save_agent(config)

    # Re-read to get fresh memory
    updated = parse_agent(agent_id)
    if not updated:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found after update")

    return AgentDetail(
        id=updated.id,
        name=updated.name,
        role=updated.role,
        icon=updated.icon,
        color=updated.color,
        skills=updated.skills,
        permissions=updated.permissions,
        prompt=updated.prompt,
        memory="\n".join(updated.memory),
    )


@router.delete("/{agent_id}")
async def remove_agent(agent_id: str):
    """Delete an agent folder from the repo."""
    deleted = delete_agent(agent_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")

    return {"ok": True, "deleted": agent_id}


@router.get("/{agent_id}/memory", response_model=MemoryResponse)
async def get_agent_memory(agent_id: str):
    """Get memory file content from Vault."""
    resolved_id = _resolve_agent_id(agent_id)
    memory = _load_memory(resolved_id)

    return MemoryResponse(
        agent_id=resolved_id,
        entries=memory,
    )


@router.put("/{agent_id}/memory", response_model=MemoryResponse)
async def put_agent_memory(agent_id: str, request: ReplaceMemoryRequest):
    """Replace the full memory content for an agent."""
    resolved_id = _resolve_agent_id(agent_id)
    replace_memory(resolved_id, request.content)

    # Re-read to return fresh data
    memory = _load_memory(resolved_id)
    return MemoryResponse(
        agent_id=resolved_id,
        entries=memory,
    )
