"""Utilities for agent message attachments.

Handles upload storage, attachment validation, text extraction, and
prompt assembly for the agent runtime.
"""

from __future__ import annotations

import mimetypes
import re
import subprocess
import uuid
import zipfile
from pathlib import Path
from typing import Any, TypedDict
from xml.etree import ElementTree

from fastapi import UploadFile
from ..settings import SESSIONS_DIR, settings

TEXT_EXTENSIONS = {
    ".txt",
    ".md",
    ".json",
    ".csv",
    ".tsv",
    ".log",
    ".yaml",
    ".yml",
    ".xml",
}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

MAX_TEXT_CHARS_PER_FILE = settings.atlas_attachment_max_chars
MAX_TEXT_CHARS_TOTAL = settings.atlas_attachment_total_max_chars


class AttachmentMeta(TypedDict):
    attachment_id: str
    name: str
    path: str
    mime: str
    size: int


class AttachmentContext(TypedDict):
    attachment_id: str
    name: str
    path: str
    mime: str
    size: int
    text_excerpt: str
    note: str


def get_session_attachments_dir(session_id: str) -> Path:
    """Return the attachments directory for a session, creating it if missing."""
    attachments_dir = SESSIONS_DIR / session_id / "attachments"
    attachments_dir.mkdir(parents=True, exist_ok=True)
    return attachments_dir


def _sanitize_filename(filename: str) -> str:
    """Keep file names safe for local storage while preserving extensions."""
    base = Path(filename or "attachment").name
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", base).strip("._")
    return safe or "attachment"


def _guess_mime(filename: str, content_type: str | None) -> str:
    if content_type:
        return content_type
    guessed, _ = mimetypes.guess_type(filename)
    return guessed or "application/octet-stream"


async def save_session_attachment(session_id: str, file: UploadFile) -> AttachmentMeta:
    """Store an uploaded file under ~/.codos/sessions/<id>/attachments/."""
    attachments_dir = get_session_attachments_dir(session_id)

    attachment_id = str(uuid.uuid4())
    original_name = file.filename or "attachment"
    safe_name = _sanitize_filename(original_name)
    stored_name = f"{attachment_id}_{safe_name}"
    stored_path = attachments_dir / stored_name

    size = 0
    with stored_path.open("wb") as handle:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            handle.write(chunk)
            size += len(chunk)

    await file.close()

    return {
        "attachment_id": attachment_id,
        "name": original_name,
        "path": str(stored_path.resolve()),
        "mime": _guess_mime(original_name, file.content_type),
        "size": size,
    }


def _truncate_text(text: str, limit: int) -> str:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    if len(normalized) <= limit:
        return normalized
    return normalized[:limit].rstrip() + "\n...[truncated]"


def _extract_text_file(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return ""


def _extract_docx_text(path: Path) -> str:
    try:
        with zipfile.ZipFile(path) as archive:
            xml_payload = archive.read("word/document.xml")

        root = ElementTree.fromstring(xml_payload)
        namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        fragments = [node.text.strip() for node in root.findall(".//w:t", namespace) if node.text and node.text.strip()]
        return "\n".join(fragments)
    except Exception:
        return ""


def _extract_pdf_text(path: Path) -> str:
    # Primary path: pypdf if installed.
    try:
        from pypdf import PdfReader  # type: ignore

        reader = PdfReader(str(path))
        pages: list[str] = []
        for page in reader.pages:
            text = page.extract_text() or ""
            if text:
                pages.append(text)
        if pages:
            return "\n\n".join(pages)
    except Exception:
        pass

    # Fallback: pdftotext executable if available.
    try:
        result = subprocess.run(
            ["pdftotext", str(path), "-"],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        if result.returncode == 0 and result.stdout:
            return result.stdout
    except Exception:
        pass

    return ""


def _resolve_session_attachment_path(session_id: str, raw_path: str) -> Path | None:
    try:
        candidate = Path(raw_path).expanduser().resolve(strict=True)
    except Exception:
        return None

    base_dir = get_session_attachments_dir(session_id).resolve()
    try:
        candidate.relative_to(base_dir)
    except ValueError:
        return None

    if not candidate.is_file():
        return None

    return candidate


def _extract_attachment_text(path: Path, mime: str) -> tuple[str, str]:
    suffix = path.suffix.lower()

    if mime.startswith("text/") or suffix in TEXT_EXTENSIONS:
        text = _extract_text_file(path)
        if text.strip():
            return text, "text"
        return "", "text_empty"

    if mime == "application/pdf" or suffix == ".pdf":
        text = _extract_pdf_text(path)
        if text.strip():
            return text, "pdf"
        return "", "pdf_unreadable"

    if mime == DOCX_MIME or suffix == ".docx":
        text = _extract_docx_text(path)
        if text.strip():
            return text, "docx"
        return "", "docx_unreadable"

    if suffix in IMAGE_EXTENSIONS or mime.startswith("image/"):
        return "", "image"

    return "", "binary"


def _build_attachment_note(extraction_mode: str) -> str:
    if extraction_mode == "image":
        return "Image attached. MVP mode: OCR/vision is not enabled yet."
    if extraction_mode == "pdf_unreadable":
        return "PDF attached, but text extraction failed."
    if extraction_mode == "docx_unreadable":
        return "DOCX attached, but text extraction failed."
    if extraction_mode == "text_empty":
        return "Text file attached, but it appears empty."
    if extraction_mode == "binary":
        return "Binary file attached. No text extraction in MVP."
    return ""


def build_attachment_contexts(session_id: str, attachments_payload: Any) -> list[AttachmentContext]:
    """Validate client attachment payload and extract prompt context."""
    if not isinstance(attachments_payload, list):
        return []

    contexts: list[AttachmentContext] = []
    remaining_chars = MAX_TEXT_CHARS_TOTAL

    for raw_item in attachments_payload:
        if not isinstance(raw_item, dict):
            continue

        raw_path = raw_item.get("path")
        if not isinstance(raw_path, str) or not raw_path:
            continue

        resolved_path = _resolve_session_attachment_path(session_id, raw_path)
        if resolved_path is None:
            continue

        name = raw_item.get("name") if isinstance(raw_item.get("name"), str) else resolved_path.name
        attachment_id = (
            raw_item.get("attachment_id")
            if isinstance(raw_item.get("attachment_id"), str)
            else resolved_path.stem.split("_", 1)[0]
        )
        mime = raw_item.get("mime") if isinstance(raw_item.get("mime"), str) else _guess_mime(name, None)

        raw_size = raw_item.get("size")
        if isinstance(raw_size, int) and raw_size >= 0:
            size = raw_size
        else:
            try:
                size = resolved_path.stat().st_size
            except OSError:
                size = 0

        extracted_text, extraction_mode = _extract_attachment_text(resolved_path, mime)
        excerpt = ""

        if extracted_text and remaining_chars > 0:
            excerpt_limit = min(MAX_TEXT_CHARS_PER_FILE, remaining_chars)
            excerpt = _truncate_text(extracted_text, excerpt_limit)
            remaining_chars -= len(excerpt)

        note = _build_attachment_note(extraction_mode)
        if extracted_text and len(extracted_text) > len(excerpt):
            suffix = "Extracted text was truncated for prompt size limits."
            note = f"{note} {suffix}".strip()

        contexts.append(
            {
                "attachment_id": attachment_id,
                "name": name,
                "path": str(resolved_path),
                "mime": mime,
                "size": size,
                "text_excerpt": excerpt,
                "note": note,
            }
        )

    return contexts


def build_prompt_with_attachments(
    content: str, session_id: str, attachments_payload: Any
) -> tuple[str, list[AttachmentContext]]:
    """Append an "Attached files" section to the prompt."""
    contexts = build_attachment_contexts(session_id, attachments_payload)
    if not contexts:
        return content, []

    lines = ["Attached files:"]

    for index, attachment in enumerate(contexts, start=1):
        lines.append(f"{index}. {attachment['name']} (mime: {attachment['mime']}, size: {attachment['size']} bytes)")
        lines.append(f"   path: {attachment['path']}")

        if attachment["text_excerpt"]:
            lines.append("   extracted_text:")
            lines.append(attachment["text_excerpt"])

        if attachment["note"]:
            lines.append(f"   note: {attachment['note']}")

    attachment_block = "\n".join(lines)
    prompt_base = content.strip()
    if prompt_base:
        return f"{prompt_base}\n\n{attachment_block}", contexts
    return attachment_block, contexts
