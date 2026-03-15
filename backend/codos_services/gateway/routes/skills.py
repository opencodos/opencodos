"""
Skills routes for the Atlas UI.
Lists skills from skills/*/SKILL.md with frontmatter.
"""

import re
from pathlib import Path

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from backend.codos_models.settings import settings

from ..auth import require_api_key

router = APIRouter(prefix="/api/skills", tags=["skills"], dependencies=[Depends(require_api_key)])


class SkillInfo(BaseModel):
    id: str
    name: str
    trigger: str
    description: str
    category: str


def _load_codos_path() -> Path:
    return settings.get_codos_path()


def _parse_frontmatter(content: str) -> dict:
    if not content.startswith("---"):
        return {}
    end = content.find("\n---", 3)
    if end == -1:
        return {}
    block = content[3:end].strip()
    data: dict[str, str] = {}
    for line in block.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        data[key.strip()] = value.strip().strip('"').strip("'")
    return data


def _extract_title(content: str) -> str | None:
    for line in content.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return None


def _slugify(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^\w\s-]", "", value)
    value = re.sub(r"\s+", "-", value)
    return value or "skill"


def _infer_category(dir_name: str) -> str:
    name = dir_name.lower()
    if name in {
        "morning brief",
        "daily todo",
        "weekly review",
        "research",
        "brief feedback",
        "compound",
        "eod",
        "granola summary",
        "parallel research",
    }:
        return "Core"
    if name in {"draft message", "write message", "schedule meeting"}:
        return "Communication"
    if name in {"memory update", "profile", "callprep", "call prep"}:
        return "People"
    if name in {
        "engineering plan",
        "react best practices",
        "supabase postgres",
        "mcp builder",
        "qmd",
        "deep planning",
        "agent browser",
        "error log",
        "karpathy",
        "skill creator",
        "skill judge",
        "frontend",
        "scheduled workflows",
    }:
        return "Engineering"
    if name in {"frontend design", "web design", "remotion"}:
        return "Design"
    if name in {
        "copywriting",
        "social content",
        "brand storytelling",
        "browse",
        "contentloop",
        "twitter",
        "sales deck",
    }:
        return "Content"
    if name in {
        "founder sales",
        "pricing strategy",
        "positioning messaging",
        "launch strategy",
        "marketing psychology",
        "signup flow cro",
    }:
        return "Business"
    if name in {"docx", "pdf", "pptx", "xlsx"}:
        return "Documents"
    return "Other"


@router.get("", response_model=list[SkillInfo])
async def list_skills() -> list[SkillInfo]:
    codos_path = _load_codos_path()
    skills_dir = codos_path / "skills"
    if not skills_dir.exists():
        return []

    skills: list[SkillInfo] = []
    for skill_dir in sorted(skills_dir.iterdir()):
        if not skill_dir.is_dir():
            continue
        skill_file = skill_dir / "SKILL.md"
        if not skill_file.exists():
            continue
        try:
            content = skill_file.read_text(encoding="utf-8")
        except Exception:
            continue

        frontmatter = _parse_frontmatter(content)
        name = frontmatter.get("name") or skill_dir.name
        title = _extract_title(content) or skill_dir.name
        description = frontmatter.get("description") or ""
        category = _infer_category(skill_dir.name)
        trigger = f"/{_slugify(name)}"
        skills.append(
            SkillInfo(
                id=_slugify(name),
                name=title,
                trigger=trigger,
                description=description,
                category=category,
            )
        )

    return skills
