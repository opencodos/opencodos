"""Pydantic models for the setup wizard API."""

from __future__ import annotations

from pydantic import BaseModel, Field


class SystemInfoResponse(BaseModel):
    name: str
    timezone: str


class ClaudeCheckResponse(BaseModel):
    installed: bool
    version: str | None = None
    path: str | None = None


class BunCheckResponse(BaseModel):
    installed: bool
    version: str | None = None
    path: str | None = None


class DependencyStatus(BaseModel):
    name: str
    installed: bool
    version: str | None = None
    required_version: str = "1.0"
    status: str = "missing"  # 'ok', 'warning', 'missing'
    install_command: str = ""
    logged_in: bool | None = None  # None for deps without login (e.g. bun)
    status_message: str | None = None  # e.g. "Installed but not logged in"
    debug_info: str | None = None  # diagnostic details when login check fails


class AllDependenciesResponse(BaseModel):
    all_ok: bool
    dependencies: list[DependencyStatus]


class DetectedPaths(BaseModel):
    codos_path: str | None = None
    vault_path: str | None = None
    codos_exists: bool = False
    vault_exists: bool = False


class RepoInitializeRequest(BaseModel):
    codos_path: str
    vault_path: str
    create_if_missing: bool = True


class RepoInitializeResponse(BaseModel):
    success: bool
    paths_json_created: bool
    codos_created: bool
    vault_created: bool
    message: str


class TelegramSendCodeRequest(BaseModel):
    phone: str | None = None  # Frontend sends 'phone'
    phone_number: str | None = None  # Backend/API uses 'phone_number'

    def get_phone(self) -> str:
        """Get phone number from either field."""
        return self.phone or self.phone_number or ""


class TelegramSendCodeResponse(BaseModel):
    success: bool
    phone_code_hash: str | None = None
    message: str


class TelegramVerifyCodeRequest(BaseModel):
    phone: str | None = None  # Frontend sends 'phone'
    phone_number: str | None = None  # Backend/API uses 'phone_number'
    code: str
    phone_code_hash: str | None = None
    password: str | None = None  # For 2FA

    def get_phone(self) -> str:
        """Get phone number from either field."""
        return self.phone or self.phone_number or ""


class TelegramVerifyCodeResponse(BaseModel):
    success: bool
    session_created: bool = False
    needs_2fa: bool = False
    username: str | None = None
    message: str


class TelegramBotVerifyRequest(BaseModel):
    bot_token: str


class TelegramBotVerifyResponse(BaseModel):
    success: bool
    bot_username: str | None = None
    bot_id: int | None = None
    message: str


class TelegramBotSaveRequest(BaseModel):
    bot_token: str
    authorized_user_ids: str  # Comma-separated user IDs


class TelegramBotSaveResponse(BaseModel):
    success: bool
    message: str


class TelegramBotStatusResponse(BaseModel):
    configured: bool
    running: bool
    pid: int | None = None
    exit_code: int | None = None
    message: str


class SyncStartRequest(BaseModel):
    connectors: list[str] = Field(default_factory=lambda: ["slack", "telegram", "gmail", "calendar"])


class SyncStartResponse(BaseModel):
    task_id: str
    message: str


class SyncStatusResponse(BaseModel):
    task_id: str
    status: str  # pending, running, completed, failed
    progress: float  # 0.0 to 1.0
    connectors: dict[str, dict]  # connector -> {status, progress, error}
    started_at: str | None = None
    completed_at: str | None = None
    error: str | None = None


class PreflightCheckResult(BaseModel):
    connector: str
    ready: bool
    reason: str | None = None


class PreflightRequest(BaseModel):
    connectors: list[str]


class PreflightResponse(BaseModel):
    results: list[PreflightCheckResult]
    all_ready: bool


class RetryRequest(BaseModel):
    task_id: str
    connectors: list[str]


class WorkspaceInfo(BaseModel):
    name: str
    path: str
    has_claude_md: bool
    last_modified: str | None = None


class WorkspacesDetectResponse(BaseModel):
    workspaces: list[WorkspaceInfo]


class WorkspaceCreateRequest(BaseModel):
    name: str
    template: str | None = None  # e.g., "default", "empty"


class WorkspaceCreateResponse(BaseModel):
    success: bool
    path: str
    message: str


class ApiKeysInput(BaseModel):
    anthropic: str | None = None
    parallel: str | None = None


class CompleteSetupRequest(BaseModel):
    generate_claude_md: bool = True
    claude_md_template: str | None = None
    user_name: str | None = None
    timezone: str | None = None
    api_keys: ApiKeysInput | None = None
    goals: str | None = None
    telegram_bot_token: str | None = None
    authorized_user_ids: str | None = None
    connectors: list[str] | None = None


class CompleteSetupResponse(BaseModel):
    success: bool
    config_saved: bool
    claude_md_created: bool
    sessions_dir_created: bool = False
    hooks_configured: bool = False
    message: str


class SaveProgressRequest(BaseModel):
    user_name: str | None = None
    timezone: str | None = None
    api_keys: ApiKeysInput | None = None
    goals: str | None = None
    connectors: list[str] | None = None
    telegram_bot_token: str | None = None
    authorized_user_ids: str | None = None


class SaveProgressResponse(BaseModel):
    success: bool
    keys_saved: list[str] = []
    message: str


class ResetResponse(BaseModel):
    success: bool
    message: str


class ExistingKeysResponse(BaseModel):
    """Response with existing API keys (masked for display)."""

    anthropic: str | None = None
    gemini: str | None = None
    assemblyai: str | None = None
    parallel: str | None = None
    has_anthropic: bool = False
    has_gemini: bool = False
    has_assemblyai: bool = False
    has_parallel: bool = False


class SetupStatusResponse(BaseModel):
    """High-level onboarding status used by app startup routing."""

    needs_setup: bool
    setup_completed: bool
    setup_completed_flag: bool
    legacy_install_detected: bool
    paths_configured: bool
    codos_path: str | None = None
    vault_path: str | None = None


class AutoInitializeResponse(BaseModel):
    success: bool
    codos_path: str
    vault_path: str
    message: str


class InstallDependencyRequest(BaseModel):
    name: str  # 'bun' or 'claude'


class InstallDependencyResponse(BaseModel):
    success: bool
    message: str
    output: str | None = None
