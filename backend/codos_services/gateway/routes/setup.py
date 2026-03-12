"""Setup routes for the Codos wizard.

Thin route handlers that delegate to usecase modules.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
from datetime import datetime
from pathlib import Path

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from loguru import logger

from backend.codos_models import setup as setup_models
from backend.codos_models.connector_commands import CONNECTOR_COMMANDS, Runtime
from backend.codos_models.exceptions import DependencyNotInstalledException, InvalidInputError
from backend.codos_models.secrets import SecretsBackendResponse, SecretsBackendSetRequest, SecretsBackendSetResponse
from backend.codos_models.settings import CODOS_CONFIG_DIR, CONFIG_FILE, PATHS_FILE, SESSIONS_DIR, settings
from backend.codos_usecases.connector_sync import (
    clear_sync_tasks,
    create_sync_task,
    get_sync_tasks,
    get_sync_tasks_file,
    load_sync_tasks_from_disk,
    normalize_connector_name,
    run_retry_task,
    run_sync_task,
)
from backend.codos_usecases.dependency_check import check_claude_login, get_bun_info, get_claude_info
from backend.codos_usecases.dependency_install import auto_install_bun, install_dependency
from backend.codos_usecases.path_detection import (
    COMMON_CODOS_LOCATIONS,
    SUGGESTED_CODOS_PATH,
    detect_existing_paths,
    get_repo_root,
    is_codos_repo,
)
from backend.codos_usecases.setup_completion import (
    copy_env_sh,
    generate_vault_claude_md,
    migrate_global_claude_md,
    save_api_keys,
    seed_config_json,
    setup_hooks,
    write_paths_json,
)
from backend.codos_usecases.vault_init import (
    create_codos_folder_structure,
    create_vault_folder_structure,
    create_vault_template_files,
    seed_about_me_name,
    validate_workspace_name,
    write_goals_file,
)
from backend.codos_utils.entity import get_entity_id
from backend.codos_utils.paths import ensure_config_dir, mask_secret, normalize_path
from backend.codos_utils.secrets import get_secrets_backend, get_secrets_backend_type
from backend.codos_utils.secrets.protocol import SecretsBackendType
from backend.codos_utils.system import get_system_name, get_system_timezone

from ..auth import require_api_key
from .workflows import _run_schedule_command

TELEGRAM_AGENT_URL = settings.telegram_agent_url

router = APIRouter(
    prefix="/api/setup",
    tags=["setup"],
    dependencies=[Depends(require_api_key)],
)


@router.get("/detect-system-info", response_model=setup_models.SystemInfoResponse)
async def detect_system_info():
    return setup_models.SystemInfoResponse(name=get_system_name(), timezone=get_system_timezone())


@router.get("/check-claude", response_model=setup_models.ClaudeCheckResponse)
async def check_claude():
    installed, version, path = get_claude_info()
    return setup_models.ClaudeCheckResponse(installed=installed, version=version, path=path)


@router.get("/check-bun", response_model=setup_models.BunCheckResponse)
async def check_bun():
    installed, version, path = get_bun_info()
    return setup_models.BunCheckResponse(installed=installed, version=version, path=path)


@router.get("/check-dependencies", response_model=setup_models.AllDependenciesResponse)
async def check_dependencies():
    """Check ALL agent dependencies at once. Auto-installs bun if missing."""
    dependencies: list[setup_models.DependencyStatus] = []

    # Bun — auto-install if missing
    bun_installed, bun_version, bun_path = get_bun_info()
    if not bun_installed:
        install_success, install_msg = await auto_install_bun()
        if install_success:
            bun_bin = Path.home() / ".bun" / "bin" / "bun"
            if bun_bin.exists():
                bun_installed = True
                try:
                    result = subprocess.run([str(bun_bin), "--version"], capture_output=True, text=True, timeout=5)
                    bun_version = result.stdout.strip() if result.returncode == 0 else None
                except Exception:
                    bun_version = "installed"

    dependencies.append(
        setup_models.DependencyStatus(
            name="bun",
            installed=bun_installed,
            version=bun_version,
            required_version="1.0",
            status="ok" if bun_installed else "missing",
            install_command="curl -fsSL https://bun.sh/install | bash",
        )
    )

    # Claude
    claude_installed, claude_version, _ = get_claude_info()
    claude_debug = None
    if claude_installed:
        logged_in, _email, claude_debug = check_claude_login()
        if logged_in:
            claude_status, claude_install_cmd, claude_status_msg = "ok", "", None
        else:
            claude_status, claude_install_cmd, claude_status_msg = "warning", "claude", "Installed but not logged in"
    else:
        logged_in = None
        claude_status = "missing"
        claude_install_cmd = "curl -fsSL https://claude.ai/install.sh | bash"
        claude_status_msg = None

    dependencies.append(
        setup_models.DependencyStatus(
            name="claude",
            installed=claude_installed,
            version=claude_version,
            required_version="1.0",
            status=claude_status,
            install_command=claude_install_cmd,
            logged_in=logged_in,
            status_message=claude_status_msg,
            debug_info=claude_debug,
        )
    )

    all_ok = all(dep.status == "ok" for dep in dependencies)
    return setup_models.AllDependenciesResponse(all_ok=all_ok, dependencies=dependencies)


@router.post("/install-dependency", response_model=setup_models.InstallDependencyResponse)
async def install_dependency_route(request: setup_models.InstallDependencyRequest):
    success, message, output = install_dependency(request.name.lower())
    return setup_models.InstallDependencyResponse(success=success, message=message, output=output)


@router.api_route("/repos/detect", methods=["GET", "POST"], response_model=setup_models.DetectedPaths)
async def detect_repos():
    codos_path, vault_path = detect_existing_paths()
    codos_exists = codos_path is not None
    vault_exists = vault_path is not None
    if not codos_path:
        codos_path = str(SUGGESTED_CODOS_PATH)
    if not vault_path:
        vault_path = str(Path(settings.vault_path))
    return setup_models.DetectedPaths(
        codos_path=codos_path, vault_path=vault_path, codos_exists=codos_exists, vault_exists=vault_exists
    )


@router.post("/repos/initialize", response_model=setup_models.RepoInitializeResponse)
async def initialize_repos(request: setup_models.RepoInitializeRequest):
    ensure_config_dir()
    codos_path = normalize_path(request.codos_path)
    vault_path = normalize_path(request.vault_path)

    nested_repo = codos_path / "codos"
    if not is_codos_repo(codos_path) and is_codos_repo(nested_repo):
        codos_path = nested_repo

    codos_created = False
    vault_created = False
    if request.create_if_missing:
        if not codos_path.exists():
            create_codos_folder_structure(codos_path)
            codos_created = True
        if not vault_path.exists():
            create_vault_folder_structure(vault_path)
            vault_created = True
        else:
            create_vault_template_files(vault_path)

    write_paths_json(codos_path, vault_path)
    copy_env_sh(codos_path)
    seed_config_json(get_entity_id(), get_system_name())

    return setup_models.RepoInitializeResponse(
        success=True,
        paths_json_created=True,
        codos_created=codos_created,
        vault_created=vault_created,
        message=f"Paths saved to {PATHS_FILE}",
    )


@router.post("/auto-initialize", response_model=setup_models.AutoInitializeResponse)
async def auto_initialize():
    ensure_config_dir()

    codos_path = get_repo_root()
    if not codos_path:
        for loc in COMMON_CODOS_LOCATIONS:
            if loc.exists() and is_codos_repo(loc):
                codos_path = loc
                break
    if not codos_path:
        codos_path = Path.home() / "codos"

    vault_path = Path.home() / "codos_vault"
    if not vault_path.exists():
        create_vault_folder_structure(vault_path)
    else:
        create_vault_template_files(vault_path)

    write_paths_json(codos_path, vault_path)
    copy_env_sh(codos_path)
    seed_config_json(get_entity_id(), get_system_name())

    return setup_models.AutoInitializeResponse(
        success=True, codos_path=str(codos_path), vault_path=str(vault_path), message="Auto-initialized successfully"
    )


@router.get("/existing-keys", response_model=setup_models.ExistingKeysResponse)
async def get_existing_keys():
    result = setup_models.ExistingKeysResponse()
    existing_vars = get_secrets_backend().get_all()
    if not existing_vars:
        return result

    if existing_vars.get("ANTHROPIC_API_KEY"):
        result.anthropic = mask_secret(existing_vars["ANTHROPIC_API_KEY"])
        result.has_anthropic = True
    gemini_key = existing_vars.get("GEMINI_API_KEY") or existing_vars.get("GOOGLE_API_KEY")
    if gemini_key:
        result.gemini = mask_secret(gemini_key)
        result.has_gemini = True
    if existing_vars.get("ASSEMBLYAI_API_KEY"):
        result.assemblyai = mask_secret(existing_vars["ASSEMBLYAI_API_KEY"])
        result.has_assemblyai = True
    if existing_vars.get("PARALLEL_API_KEY"):
        result.parallel = mask_secret(existing_vars["PARALLEL_API_KEY"])
        result.has_parallel = True
    return result


@router.get("/status", response_model=setup_models.SetupStatusResponse)
async def get_setup_status():
    ensure_config_dir()

    setup_completed_flag = False
    config: dict = {}
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE) as f:
                config = json.load(f)
            setup_completed_flag = bool(config.get("setup_completed"))
        except (OSError, json.JSONDecodeError):
            pass

    codos_path: str | None = None
    vault_path: str | None = None
    paths_configured = False
    codos_repo_valid = False
    vault_valid = False

    if PATHS_FILE.exists():
        try:
            with open(PATHS_FILE) as f:
                paths = json.load(f)
            codos_path = paths.get("codos_path")
            vault_path = paths.get("vault_path")
            paths_configured = bool(codos_path and vault_path)
            if codos_path:
                codos_repo_valid = is_codos_repo(Path(codos_path).expanduser())
            if vault_path:
                vault_candidate = Path(vault_path).expanduser()
                vault_valid = vault_candidate.exists() and vault_candidate.is_dir()
        except (OSError, json.JSONDecodeError):
            pass

    from backend.codos_utils.entity import compute_current_user_entity

    stored_entity = config.get("entityId", "")
    current_entity = compute_current_user_entity()
    user_matches = (not stored_entity) or (stored_entity == current_entity)

    install_valid = paths_configured and codos_repo_valid and vault_valid
    legacy_install_detected = install_valid and user_matches
    setup_completed = (setup_completed_flag and install_valid) or legacy_install_detected

    return setup_models.SetupStatusResponse(
        needs_setup=not setup_completed,
        setup_completed=setup_completed,
        setup_completed_flag=setup_completed_flag,
        legacy_install_detected=legacy_install_detected,
        paths_configured=paths_configured,
        codos_path=codos_path,
        vault_path=vault_path,
    )


@router.post("/save-progress", response_model=setup_models.SaveProgressResponse)
async def save_progress(request: setup_models.SaveProgressRequest):
    ensure_config_dir()
    if not PATHS_FILE.exists():
        await auto_initialize()

    keys_saved = save_api_keys(request.api_keys, request.telegram_bot_token, request.authorized_user_ids)

    if request.goals:
        try:
            write_goals_file(Path(settings.get_vault_path()), request.goals)
        except Exception:
            pass

    return setup_models.SaveProgressResponse(
        success=True, keys_saved=keys_saved, message=f"Progress saved. {len(keys_saved)} key(s) written."
    )


@router.post("/telegram/send-code", response_model=setup_models.TelegramSendCodeResponse)
async def telegram_send_code(request: setup_models.TelegramSendCodeRequest):
    phone = request.get_phone()
    if not phone:
        raise HTTPException(status_code=400, detail="Phone number is required")
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            url = f"{TELEGRAM_AGENT_URL}/telegram/phone/send-code"
            resp = await client.post(url, json={"phone_number": phone})
            if resp.status_code != 200:
                error = resp.json().get("detail", "Failed to send code")
                return setup_models.TelegramSendCodeResponse(success=False, message=error)
            data = resp.json()
            return setup_models.TelegramSendCodeResponse(
                success=data.get("success", False),
                phone_code_hash=data.get("phone_code_hash"),
                message=data.get("message", "Code sent"),
            )
    except httpx.ConnectError:
        raise HTTPException(
            status_code=503,
            detail="Telegram agent not running",
        ) from None
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Proxy error: {e}") from e


@router.post("/telegram/verify-code", response_model=setup_models.TelegramVerifyCodeResponse)
async def telegram_verify_code(request: setup_models.TelegramVerifyCodeRequest):
    phone = request.get_phone()
    if not phone:
        raise HTTPException(status_code=400, detail="Phone number is required")
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            payload = {"phone_number": phone, "code": request.code}
            if request.phone_code_hash:
                payload["phone_code_hash"] = request.phone_code_hash
            if request.password:
                payload["password"] = request.password
            resp = await client.post(f"{TELEGRAM_AGENT_URL}/telegram/phone/verify-code", json=payload)
            data = resp.json()
            if resp.status_code != 200:
                error = data.get("detail", "Verification failed")
                return setup_models.TelegramVerifyCodeResponse(
                    success=False,
                    message=error,
                )
            return setup_models.TelegramVerifyCodeResponse(
                success=data.get("success", False),
                session_created=data.get("session_created", False),
                needs_2fa=data.get("needs_2fa", False),
                username=data.get("username"),
                message=data.get("message", "Verified"),
            )
    except httpx.ConnectError:
        raise HTTPException(
            status_code=503,
            detail="Telegram agent not running",
        ) from None
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Proxy error: {e}") from e


def _resolve_telegram_agent_command() -> tuple[list[str], Path, dict[str, str]]:
    codos_root = settings.get_codos_path()
    venv_python = settings.get_backend_venv_python()
    if not venv_python.exists():
        raise FileNotFoundError(f"Python venv not found: {venv_python}. Run bootstrap.sh to set up venvs.")
    return (
        [str(venv_python), "-m", "backend", "telegram-agent", "server"],
        codos_root,
        {"PYTHONPATH": str(codos_root)},
    )


@router.post("/telegram/start-agent")
async def start_telegram_agent():
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(f"{TELEGRAM_AGENT_URL}/telegram/auth/status")
            if resp.status_code == 200:
                return {"success": True, "already_running": True, "message": "Already running"}
    except (httpx.ConnectError, httpx.TimeoutException):
        pass

    try:
        argv, cwd, extra_env = _resolve_telegram_agent_command()
        logger.info(f"telegram-agent resolved: argv={argv} cwd={cwd}")
    except FileNotFoundError as e:
        logger.error(f"telegram-agent start failed: {e}")
        return {"success": False, "message": str(e)}

    try:
        env = {
            **os.environ,
            **get_secrets_backend().get_all(),
            **extra_env,
            "TELEGRAM_AGENT_PORT": str(settings.telegram_agent_port),
        }
        proc = await asyncio.create_subprocess_exec(
            *argv,
            cwd=str(cwd),
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            start_new_session=True,
        )
        await asyncio.sleep(1.5)
        if proc.returncode is not None:
            output = ""
            if proc.stdout:
                raw = await proc.stdout.read(4096)
                output = raw.decode(errors="replace")
            logger.error(f"telegram-agent exited immediately (rc={proc.returncode}): {output}")
            return {"success": False, "message": f"Agent crashed on startup (exit {proc.returncode}): {output[:500]}"}

        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.get(f"{TELEGRAM_AGENT_URL}/telegram/auth/status")
                if resp.status_code == 200:
                    return {"success": True, "already_running": False, "pid": proc.pid}
        except Exception:
            pass
        return {"success": True, "already_running": False, "pid": proc.pid, "message": "Starting..."}
    except Exception as e:
        logger.exception("Failed to start telegram-agent")
        return {"success": False, "message": str(e)}


@router.post("/telegram/restart-agent")
async def restart_telegram_agent():
    import signal

    port = str(settings.telegram_agent_port)
    killed_any = False
    try:
        result = await asyncio.create_subprocess_exec(
            "lsof",
            "-ti",
            f":{port}",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await result.communicate()
        if stdout:
            for pid_str in stdout.decode().strip().split("\n"):
                if pid_str:
                    try:
                        os.kill(int(pid_str), signal.SIGTERM)
                        killed_any = True
                    except (ProcessLookupError, ValueError):
                        pass
            if killed_any:
                await asyncio.sleep(1.0)
    except Exception:
        pass
    return {"success": True, "killed": killed_any, "message": "Agent killed; Tauri supervisor will restart it"}


@router.get("/telegram/health")
async def telegram_health():
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{TELEGRAM_AGENT_URL}/telegram/auth/status")
            if resp.status_code == 200:
                return {"running": True, "status": resp.json().get("status", "unknown")}
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="Telegram agent not running") from None
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Health check timed out") from None


@router.post("/telegram-bot/verify", response_model=setup_models.TelegramBotVerifyResponse)
async def verify_telegram_bot(request: setup_models.TelegramBotVerifyRequest):
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"https://api.telegram.org/bot{request.bot_token}/getMe")
            if resp.status_code != 200:
                return setup_models.TelegramBotVerifyResponse(success=False, message="Invalid bot token")
            data = resp.json()
            if not data.get("ok"):
                desc = data.get("description", "Invalid bot token")
                return setup_models.TelegramBotVerifyResponse(success=False, message=desc)
            result = data.get("result", {})
            return setup_models.TelegramBotVerifyResponse(
                success=True,
                bot_username=result.get("username"),
                bot_id=result.get("id"),
                message=f"Bot verified: @{result.get('username')}",
            )
    except httpx.ConnectError:
        return setup_models.TelegramBotVerifyResponse(success=False, message="Could not connect to Telegram API")
    except Exception as e:
        return setup_models.TelegramBotVerifyResponse(success=False, message=f"Verification error: {str(e)}")


@router.post("/telegram-bot/save", response_model=setup_models.TelegramBotSaveResponse)
async def save_telegram_bot(request: setup_models.TelegramBotSaveRequest):
    backend = get_secrets_backend()
    backend.set("TELEGRAM_BOT_TOKEN", request.bot_token)
    backend.set("AUTHORIZED_USER_IDS", request.authorized_user_ids.replace(" ", ""))

    setup_message = "Bot configuration saved"
    try:
        if PATHS_FILE.exists():
            with open(PATHS_FILE) as f:
                json.load(f)
            codos_path = settings.get_codos_path()

            logs_dir = codos_path / "dev" / "Logs" / "codos-bot"
            logs_dir.mkdir(parents=True, exist_ok=True)

            venv_python = settings.get_backend_venv_python()

            home = Path.home()
            launch_agents_dir = home / "Library" / "LaunchAgents"
            launch_agents_dir.mkdir(parents=True, exist_ok=True)
            plist_path = launch_agents_dir / "com.codos.codos-bot.plist"

            plist_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.codos.codos-bot</string>

    <key>ProgramArguments</key>
    <array>
        <string>{venv_python}</string>
        <string>-m</string>
        <string>backend</string>
        <string>codos-bot</string>
    </array>

    <key>WorkingDirectory</key>
    <string>{codos_path}</string>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>{logs_dir}/stdout.log</string>

    <key>StandardErrorPath</key>
    <string>{logs_dir}/stderr.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>{venv_python.parent}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>PYTHONPATH</key>
        <string>{codos_path}</string>
    </dict>
</dict>
</plist>"""

            with open(plist_path, "w") as f:
                f.write(plist_content)

            subprocess.run(["launchctl", "unload", str(plist_path)], capture_output=True)
            result = subprocess.run(["launchctl", "load", str(plist_path)], capture_output=True)
            if result.returncode == 0:
                setup_message = "Bot configured and started"
            else:
                setup_message = "Bot configured (manual start may be needed)"
    except Exception as e:
        setup_message = f"Bot configured (service setup failed: {str(e)[:50]})"

    return setup_models.TelegramBotSaveResponse(success=True, message=setup_message)


@router.get("/telegram-bot/status", response_model=setup_models.TelegramBotStatusResponse)
async def get_telegram_bot_status():
    backend = get_secrets_backend()
    configured = backend.get("TELEGRAM_BOT_TOKEN") is not None and backend.get("AUTHORIZED_USER_IDS") is not None

    running = False
    pid = None
    exit_code = None
    message = "Not configured"

    if configured:
        try:
            result = subprocess.run(["launchctl", "list"], capture_output=True, text=True, timeout=5)
            for line in result.stdout.splitlines():
                if "com.codos.codos-bot" in line:
                    parts = line.split()
                    if len(parts) >= 3:
                        pid_str, exit_str = parts[0], parts[1]
                        pid = int(pid_str) if pid_str != "-" else None
                        exit_code = int(exit_str) if exit_str != "-" else None
                        running = pid is not None
                    break
            if running:
                message = f"Running (PID {pid})"
            elif exit_code is not None and exit_code != 0:
                message = f"Crashed (exit code {exit_code})"
            else:
                message = "Configured but not running"
        except Exception:
            message = "Configured (status check failed)"

    return setup_models.TelegramBotStatusResponse(
        configured=configured, running=running, pid=pid, exit_code=exit_code, message=message
    )


@router.post("/sync/start", response_model=setup_models.SyncStartResponse)
async def start_sync(request: setup_models.SyncStartRequest, background_tasks: BackgroundTasks):
    task_id, _task = create_sync_task(request.connectors)
    background_tasks.add_task(run_sync_task, task_id, request.connectors)
    msg = f"Sync started for {len(request.connectors)} connectors"
    return setup_models.SyncStartResponse(task_id=task_id, message=msg)


@router.get("/sync/status/{task_id}", response_model=setup_models.SyncStatusResponse)
async def get_sync_status(task_id: str):
    sync_tasks = get_sync_tasks()
    if task_id not in sync_tasks:
        load_sync_tasks_from_disk()
    if task_id not in sync_tasks:
        raise HTTPException(status_code=404, detail="Sync task not found")
    return setup_models.SyncStatusResponse(**sync_tasks[task_id])


@router.post("/sync/preflight", response_model=setup_models.PreflightResponse)
async def sync_preflight(request: setup_models.PreflightRequest):
    results: list[setup_models.PreflightCheckResult] = []
    for connector in request.connectors:
        backend_name = normalize_connector_name(connector)
        if backend_name is None:
            results.append(
                setup_models.PreflightCheckResult(connector=connector, ready=False, reason="Not supported yet")
            )
            continue
        if backend_name == "google":
            results.append(setup_models.PreflightCheckResult(connector=connector, ready=True, reason=None))
            continue
        if backend_name not in CONNECTOR_COMMANDS:
            results.append(
                setup_models.PreflightCheckResult(connector=connector, ready=False, reason="No sync command configured")
            )
            continue
        config = CONNECTOR_COMMANDS[backend_name]
        if backend_name == "telegram":
            session_path = settings.get_telegram_session_path()
            if not session_path.exists():
                results.append(
                    setup_models.PreflightCheckResult(
                        connector=connector,
                        ready=False,
                        reason="Telegram session not authenticated",
                    )
                )
                continue
        if config["runtime"] == Runtime.BUN:
            try:
                _ = settings.bun_path
            except DependencyNotInstalledException:
                results.append(
                    setup_models.PreflightCheckResult(connector=connector, ready=False, reason="bun not installed")
                )
                continue
        results.append(setup_models.PreflightCheckResult(connector=connector, ready=True))

    return setup_models.PreflightResponse(results=results, all_ready=all(r.ready for r in results))


@router.post("/sync/retry", response_model=setup_models.SyncStartResponse)
async def retry_sync(request: setup_models.RetryRequest, background_tasks: BackgroundTasks):
    sync_tasks = get_sync_tasks()
    if request.task_id not in sync_tasks:
        load_sync_tasks_from_disk()
    if request.task_id not in sync_tasks:
        raise HTTPException(status_code=404, detail="Sync task not found")

    task = sync_tasks[request.task_id]
    for connector in request.connectors:
        task["connectors"][connector] = {"status": "pending", "progress": 0.0}
    task["status"] = "running"
    task["error"] = None
    background_tasks.add_task(run_retry_task, request.task_id, request.connectors)
    msg = f"Retry started for {len(request.connectors)} connectors"
    return setup_models.SyncStartResponse(task_id=request.task_id, message=msg)


@router.get("/workspaces/detect", response_model=setup_models.WorkspacesDetectResponse)
async def detect_workspaces():
    vault_path = settings.get_vault_path()
    projects_path = vault_path / "2 - Projects"
    workspaces = []
    if projects_path.exists():
        for item in projects_path.iterdir():
            if item.is_dir():
                claude_md = item / "CLAUDE.md"
                stat = item.stat()
                workspaces.append(
                    setup_models.WorkspaceInfo(
                        name=item.name,
                        path=str(item),
                        has_claude_md=claude_md.exists(),
                        last_modified=datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    )
                )
    workspaces.sort(key=lambda x: x.last_modified or "", reverse=True)
    return setup_models.WorkspacesDetectResponse(workspaces=workspaces)


@router.post("/workspaces/create", response_model=setup_models.WorkspaceCreateResponse)
async def create_workspace(request: setup_models.WorkspaceCreateRequest):
    try:
        workspace_name = validate_workspace_name(request.name)
    except InvalidInputError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    vault_path = settings.get_vault_path()
    workspace_path = vault_path / "2 - Projects" / workspace_name
    if workspace_path.exists():
        raise HTTPException(status_code=400, detail=f"Workspace '{workspace_name}' already exists")

    workspace_path.mkdir(parents=True, exist_ok=True)
    (workspace_path / "notes").mkdir(exist_ok=True)
    (workspace_path / "resources").mkdir(exist_ok=True)

    if request.template != "empty":
        claude_md_content = f"""# {workspace_name}

Project workspace created on {datetime.utcnow().strftime("%Y-%m-%d")}.

## Overview

<!-- Describe the project here -->

## Key Files

<!-- List important files and their purposes -->

## Notes

<!-- Add project-specific instructions for Claude -->
"""
        with open(workspace_path / "CLAUDE.md", "w") as f:
            f.write(claude_md_content)

    return setup_models.WorkspaceCreateResponse(
        success=True, path=str(workspace_path), message=f"Workspace '{workspace_name}' created successfully"
    )


@router.get("/secrets-backend", response_model=SecretsBackendResponse)
async def get_secrets_backend_config() -> SecretsBackendResponse:
    current = get_secrets_backend_type()
    return SecretsBackendResponse(current=current.value, options=[t.value for t in SecretsBackendType])


@router.post("/secrets-backend", response_model=SecretsBackendSetResponse)
async def set_secrets_backend_config(request: SecretsBackendSetRequest) -> SecretsBackendSetResponse:
    try:
        backend_type = SecretsBackendType(request.backend)
    except ValueError as exc:
        valid = ", ".join(t.value for t in SecretsBackendType)
        raise HTTPException(
            status_code=400,
            detail=f"Unknown backend {request.backend!r}. Valid options: {valid}",
        ) from exc

    ensure_config_dir()
    config: dict = {}
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE) as f:
            config = json.load(f)
    config["secrets_backend"] = backend_type.value
    with open(CONFIG_FILE, "w") as f:
        json.dump(config, f, indent=2)
    return SecretsBackendSetResponse(success=True, backend=backend_type.value)


@router.post("/complete", response_model=setup_models.CompleteSetupResponse)
async def complete_setup(request: setup_models.CompleteSetupRequest):
    ensure_config_dir()
    if not PATHS_FILE.exists():
        await auto_initialize()

    codos_path = str(settings.get_codos_path())
    vault_path = str(settings.get_vault_path())
    user_name = request.user_name or get_system_name()
    timezone = request.timezone or get_system_timezone()
    entity_id = get_entity_id()

    config_data = {
        "version": "1.0.0",
        "setup_completed": True,
        "completed_at": datetime.utcnow().isoformat(),
        "codos_path": codos_path,
        "vault_path": vault_path,
        "user_name": user_name,
        "timezone": timezone,
        "entity_id": entity_id,
    }
    with open(CONFIG_FILE, "w") as f:
        json.dump(config_data, f, indent=2)

    try:
        seed_about_me_name(Path(vault_path), user_name)
    except Exception:
        pass

    if request.goals:
        try:
            write_goals_file(Path(vault_path), request.goals)
        except Exception:
            pass

    save_api_keys(request.api_keys, request.telegram_bot_token, request.authorized_user_ids)

    claude_md_created = False
    if request.generate_claude_md:
        generate_vault_claude_md(vault_path, codos_path)
        claude_md_created = True
        migrate_global_claude_md()

    Path.home().joinpath("atlas-mcp").mkdir(exist_ok=True)
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    sessions_dir_created = SESSIONS_DIR.exists()

    hooks_configured = setup_hooks(codos_path)

    tmux_warning = ""
    if not shutil.which("tmux"):
        tmux_warning = " Warning: tmux is not installed. Agent sessions require tmux for background execution."

    try:
        _run_schedule_command(Path(codos_path), ["enable-all"])
    except Exception as e:
        logger.warning(f"Failed to auto-enable scheduled workflows: {e}")

    return setup_models.CompleteSetupResponse(
        success=True,
        config_saved=True,
        claude_md_created=claude_md_created,
        sessions_dir_created=sessions_dir_created,
        hooks_configured=hooks_configured,
        message=f"Setup completed successfully!{tmux_warning}",
    )


@router.post("/reset", response_model=setup_models.ResetResponse)
async def reset_setup():
    files_removed = []

    vault_path = None
    try:
        if PATHS_FILE.exists():
            with open(PATHS_FILE) as f:
                vault_path = json.load(f).get("vaultPath")
    except Exception:
        pass

    for filename in ["config.json", "paths.json", ".env"]:
        file_path = CODOS_CONFIG_DIR / filename
        if file_path.exists():
            file_path.unlink()
            files_removed.append(str(file_path))

    if vault_path:
        vault_claude_md = Path(vault_path) / "CLAUDE.md"
        if vault_claude_md.exists():
            vault_claude_md.unlink()
            files_removed.append(str(vault_claude_md))

    clear_sync_tasks()
    sync_file = get_sync_tasks_file()
    if sync_file.exists():
        files_removed.append(str(sync_file))

    return setup_models.ResetResponse(
        success=True,
        message=f"Reset complete. Removed: {', '.join(files_removed) if files_removed else 'No files to remove'}",
    )
