"""Secrets setup schemas."""

from __future__ import annotations

from pydantic import BaseModel


class SecretsBackendResponse(BaseModel):
    current: str
    options: list[str]


class SecretsBackendSetRequest(BaseModel):
    backend: str


class SecretsBackendSetResponse(BaseModel):
    success: bool
    backend: str
