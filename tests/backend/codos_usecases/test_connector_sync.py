"""Tests for connector_sync use-case."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from backend.codos_usecases.connector_sync import (
    clear_sync_tasks,
    create_sync_task,
    get_sync_tasks,
    get_sync_tasks_file,
    load_env_vars,
    load_sync_tasks_from_disk,
    normalize_connector_name,
    persist_sync_tasks,
    run_connector_sync,
    run_retry_task,
    run_sync_task,
)


class TestNormalizeConnectorName:
    def test_maps_googlecalendar(self):
        assert normalize_connector_name("googlecalendar") == "calendar"

    def test_returns_none_for_unsupported(self):
        assert normalize_connector_name("googledrive") is None

    def test_passthrough_for_unknown(self):
        assert normalize_connector_name("slack") == "slack"

    def test_passthrough_telegram(self):
        assert normalize_connector_name("telegram") == "telegram"


class TestCreateSyncTask:
    def test_creates_task_with_connectors(self):
        task_id, task = create_sync_task(["slack", "telegram"])
        assert task["task_id"] == task_id
        assert task["status"] == "pending"
        assert "slack" in task["connectors"]
        assert "telegram" in task["connectors"]
        assert task["connectors"]["slack"]["status"] == "pending"
        get_sync_tasks().pop(task_id, None)

    def test_task_appears_in_sync_tasks(self):
        task_id, _ = create_sync_task(["gmail"])
        assert task_id in get_sync_tasks()
        get_sync_tasks().pop(task_id, None)


class TestClearSyncTasks:
    def test_clears_all_tasks(self):
        create_sync_task(["slack"])
        assert len(get_sync_tasks()) > 0
        clear_sync_tasks()
        assert len(get_sync_tasks()) == 0


class TestPersistSyncTasks:
    def test_writes_to_disk(self, tmp_path, monkeypatch):
        sync_file = tmp_path / "sync-tasks.json"
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync._SYNC_TASKS_FILE",
            sync_file,
        )
        task_id, _ = create_sync_task(["slack"])
        persist_sync_tasks()
        assert sync_file.exists()
        data = json.loads(sync_file.read_text())
        assert task_id in data
        get_sync_tasks().pop(task_id, None)

    def test_persist_handles_write_error(self, tmp_path, monkeypatch):
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync._SYNC_TASKS_FILE",
            tmp_path / "no_such_dir" / "deep" / "sync.json",
        )
        # Prevent actual mkdir from succeeding
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync._SYNC_TASKS_FILE",
            Path("/dev/null/impossible/sync.json"),
        )
        create_sync_task(["slack"])
        persist_sync_tasks()  # should not raise
        clear_sync_tasks()


class TestLoadSyncTasksFromDisk:
    def test_loads_completed_tasks(self, tmp_path, monkeypatch):
        sync_file = tmp_path / "sync-tasks.json"
        task_data = {"tid-load-1": {"status": "completed", "connectors": {}}}
        sync_file.write_text(json.dumps(task_data))
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync._SYNC_TASKS_FILE",
            sync_file,
        )
        # Ensure tid-load-1 is not already present
        get_sync_tasks().pop("tid-load-1", None)
        load_sync_tasks_from_disk()
        assert "tid-load-1" in get_sync_tasks()
        get_sync_tasks().pop("tid-load-1", None)

    def test_skips_pending_tasks(self, tmp_path, monkeypatch):
        sync_file = tmp_path / "sync-tasks.json"
        task_data = {"tid-2": {"status": "pending", "connectors": {}}}
        sync_file.write_text(json.dumps(task_data))
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync._SYNC_TASKS_FILE",
            sync_file,
        )
        clear_sync_tasks()
        load_sync_tasks_from_disk()
        assert "tid-2" not in get_sync_tasks()

    def test_handles_corrupt_file(self, tmp_path, monkeypatch):
        sync_file = tmp_path / "sync-tasks.json"
        sync_file.write_text("not json{{{")
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync._SYNC_TASKS_FILE",
            sync_file,
        )
        clear_sync_tasks()
        load_sync_tasks_from_disk()  # should not raise
        assert len(get_sync_tasks()) == 0


class TestGetSyncTasksFile:
    def test_returns_path(self):
        result = get_sync_tasks_file()
        assert isinstance(result, Path)


class TestLoadEnvVars:
    def test_returns_dict(self):
        result = load_env_vars()
        assert isinstance(result, dict)


@pytest.mark.asyncio
class TestRunConnectorSync:
    @pytest.fixture(autouse=True)
    def _cleanup(self):
        yield
        clear_sync_tasks()

    async def test_unknown_connector(self):
        task = {"connectors": {"bogus": {}}}
        sem = asyncio.Semaphore(1)
        await run_connector_sync("bogus", task, Path("/tmp"), {}, sem)
        assert task["connectors"]["bogus"]["status"] == "failed"
        assert "Unknown connector" in task["connectors"]["bogus"]["error"]

    async def test_successful_python_sync(self, tmp_path, monkeypatch):
        """Covers lines 140-195: successful python-runtime sync."""
        from backend.codos_models import connector_commands

        monkeypatch.setattr(
            connector_commands,
            "CONNECTOR_COMMANDS",
            {
                "test_py": {
                    "runtime": "python",
                    "args": ["-c", "print('ok')"],
                    "cwd": ".",
                    "timeout": 10,
                },
            },
        )
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.CONNECTOR_COMMANDS",
            connector_commands.CONNECTOR_COMMANDS,
        )
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.settings",
            type("S", (), {"get_backend_venv_python": staticmethod(lambda: "python3")})(),
        )
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.persist_sync_tasks",
            lambda: None,
        )

        task = {"connectors": {"test_py": {}}}
        sem = asyncio.Semaphore(1)
        await run_connector_sync("test_py", task, tmp_path, {}, sem)
        assert task["connectors"]["test_py"]["status"] == "completed"

    async def test_failed_sync_extracts_error(self, tmp_path, monkeypatch):
        """Covers lines 196-217: error message extraction from stderr."""
        from backend.codos_models import connector_commands

        monkeypatch.setattr(
            connector_commands,
            "CONNECTOR_COMMANDS",
            {
                "test_fail": {
                    "runtime": "python",
                    "args": ["-c", "import sys; sys.stderr.write('Error: something broke\\n'); sys.exit(1)"],
                    "cwd": ".",
                    "timeout": 10,
                },
            },
        )
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.CONNECTOR_COMMANDS",
            connector_commands.CONNECTOR_COMMANDS,
        )
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.settings",
            type("S", (), {"get_backend_venv_python": staticmethod(lambda: "python3")})(),
        )
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.persist_sync_tasks",
            lambda: None,
        )

        task = {"connectors": {"test_fail": {}}}
        sem = asyncio.Semaphore(1)
        await run_connector_sync("test_fail", task, tmp_path, {}, sem)
        assert task["connectors"]["test_fail"]["status"] == "failed"
        assert "Error:" in task["connectors"]["test_fail"]["error"]

    async def test_bun_missing_cwd(self, tmp_path, monkeypatch):
        """Covers lines 155-161: bun cwd doesn't exist."""
        from backend.codos_models import connector_commands

        monkeypatch.setattr(
            connector_commands,
            "CONNECTOR_COMMANDS",
            {
                "test_bun": {
                    "runtime": "bun",
                    "args": ["run", "test.ts"],
                    "cwd": "nonexistent_dir",
                    "timeout": 10,
                },
            },
        )
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.CONNECTOR_COMMANDS",
            connector_commands.CONNECTOR_COMMANDS,
        )
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.persist_sync_tasks",
            lambda: None,
        )

        task = {"connectors": {"test_bun": {}}}
        sem = asyncio.Semaphore(1)
        await run_connector_sync("test_bun", task, tmp_path, {}, sem)
        assert task["connectors"]["test_bun"]["status"] == "failed"
        assert "Directory not found" in task["connectors"]["test_bun"]["error"]

    async def test_bun_dependency_missing(self, tmp_path, monkeypatch):
        """Covers lines 164-170: bun not installed."""
        from backend.codos_models import connector_commands
        from backend.codos_models.exceptions import DependencyNotInstalledException

        cwd = tmp_path / "scripts"
        cwd.mkdir()

        monkeypatch.setattr(
            connector_commands,
            "CONNECTOR_COMMANDS",
            {
                "test_bun2": {
                    "runtime": "bun",
                    "args": ["run", "test.ts"],
                    "cwd": "scripts",
                    "timeout": 10,
                },
            },
        )
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.CONNECTOR_COMMANDS",
            connector_commands.CONNECTOR_COMMANDS,
        )

        def _raise_dep(*a, **kw):
            raise DependencyNotInstalledException("bun not found")

        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.settings",
            type("S", (), {"bun_path": property(_raise_dep)})(),
        )
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.persist_sync_tasks",
            lambda: None,
        )

        task = {"connectors": {"test_bun2": {}}}
        sem = asyncio.Semaphore(1)
        await run_connector_sync("test_bun2", task, tmp_path, {}, sem)
        assert task["connectors"]["test_bun2"]["status"] == "failed"
        assert "bun not found" in task["connectors"]["test_bun2"]["error"]

    async def test_exception_during_sync(self, tmp_path, monkeypatch):
        """Covers lines 228-229: generic exception caught."""
        from backend.codos_models import connector_commands

        monkeypatch.setattr(
            connector_commands,
            "CONNECTOR_COMMANDS",
            {
                "test_exc": {
                    "runtime": "python",
                    "args": ["-c", "pass"],
                    "cwd": ".",
                    "timeout": 10,
                },
            },
        )
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.CONNECTOR_COMMANDS",
            connector_commands.CONNECTOR_COMMANDS,
        )
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.settings",
            type("S", (), {"get_backend_venv_python": staticmethod(lambda: "/nonexistent/python999")})(),
        )
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.persist_sync_tasks",
            lambda: None,
        )

        task = {"connectors": {"test_exc": {}}}
        sem = asyncio.Semaphore(1)
        await run_connector_sync("test_exc", task, tmp_path, {}, sem)
        assert task["connectors"]["test_exc"]["status"] == "failed"


@pytest.mark.asyncio
class TestRunSyncTask:
    @pytest.fixture(autouse=True)
    def _cleanup(self):
        yield
        clear_sync_tasks()

    async def test_runs_and_completes(self, monkeypatch):
        """Covers lines 236-283: full run_sync_task flow."""
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.persist_sync_tasks",
            lambda: None,
        )
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.load_env_vars",
            lambda: {},
        )
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.settings",
            type("S", (), {"get_codos_path": staticmethod(lambda: Path("/tmp"))})(),
        )

        async def _noop_sync(*args, **kwargs):
            task = args[1]
            key = args[5] if len(args) > 5 else args[0]
            task["connectors"][key] = {"status": "completed", "progress": 1.0}

        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.run_connector_sync",
            _noop_sync,
        )

        task_id, _ = create_sync_task(["slack"])
        await run_sync_task(task_id, ["slack"])
        task = get_sync_tasks()[task_id]
        assert task["status"] == "completed"
        assert task["completed_at"] is not None

    async def test_google_expands_sub_connectors(self, monkeypatch):
        """Covers google expansion branch."""
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.persist_sync_tasks",
            lambda: None,
        )
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.load_env_vars",
            lambda: {},
        )
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.settings",
            type("S", (), {"get_codos_path": staticmethod(lambda: Path("/tmp"))})(),
        )

        async def _noop_sync(connector, task, *args, **kwargs):
            key = kwargs.get("status_key") or (args[2] if len(args) > 2 else connector)
            task["connectors"][key] = {"status": "completed", "progress": 1.0}

        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.run_connector_sync",
            _noop_sync,
        )

        task_id, _ = create_sync_task(["google"])
        await run_sync_task(task_id, ["google"])
        task = get_sync_tasks()[task_id]
        assert task["status"] == "completed"

    async def test_unsupported_connector_skipped(self, monkeypatch):
        """Covers googledrive None normalization branch."""
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.persist_sync_tasks",
            lambda: None,
        )
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.load_env_vars",
            lambda: {},
        )
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.settings",
            type("S", (), {"get_codos_path": staticmethod(lambda: Path("/tmp"))})(),
        )

        async def _noop_sync(*args, **kwargs):
            pass

        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.run_connector_sync",
            _noop_sync,
        )

        task_id, _ = create_sync_task(["googledrive"])
        await run_sync_task(task_id, ["googledrive"])
        task = get_sync_tasks()[task_id]
        assert task["connectors"]["googledrive"]["status"] == "completed"
        assert "Skipped" in task["connectors"]["googledrive"]["message"]

    async def test_failed_sync_sets_failed(self, monkeypatch):
        """Covers lines 276-278: failed status aggregation."""
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.persist_sync_tasks",
            lambda: None,
        )
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.load_env_vars",
            lambda: {},
        )
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.settings",
            type("S", (), {"get_codos_path": staticmethod(lambda: Path("/tmp"))})(),
        )

        async def _fail_sync(*args, **kwargs):
            task = args[1]
            key = args[5] if len(args) > 5 else args[0]
            task["connectors"][key] = {"status": "failed", "progress": 0.0, "error": "boom"}

        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.run_connector_sync",
            _fail_sync,
        )

        task_id, _ = create_sync_task(["slack"])
        await run_sync_task(task_id, ["slack"])
        task = get_sync_tasks()[task_id]
        assert task["status"] == "failed"
        assert "1 of 1" in task["error"]


@pytest.mark.asyncio
class TestRunRetryTask:
    @pytest.fixture(autouse=True)
    def _cleanup(self):
        yield
        clear_sync_tasks()

    async def test_retries_and_completes(self, monkeypatch):
        """Covers lines 288-335: full run_retry_task flow."""
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.persist_sync_tasks",
            lambda: None,
        )
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.load_env_vars",
            lambda: {},
        )
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.settings",
            type("S", (), {"get_codos_path": staticmethod(lambda: Path("/tmp"))})(),
        )

        async def _noop_sync(*args, **kwargs):
            task = args[1]
            key = args[5] if len(args) > 5 else args[0]
            task["connectors"][key] = {"status": "completed", "progress": 1.0}

        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.run_connector_sync",
            _noop_sync,
        )

        task_id, _ = create_sync_task(["slack"])
        await run_retry_task(task_id, ["slack"])
        task = get_sync_tasks()[task_id]
        assert task["status"] == "completed"

    async def test_retry_with_google(self, monkeypatch):
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.persist_sync_tasks",
            lambda: None,
        )
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.load_env_vars",
            lambda: {},
        )
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.settings",
            type("S", (), {"get_codos_path": staticmethod(lambda: Path("/tmp"))})(),
        )

        async def _noop_sync(connector, task, *args, **kwargs):
            key = kwargs.get("status_key") or (args[2] if len(args) > 2 else connector)
            task["connectors"][key] = {"status": "completed", "progress": 1.0}

        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.run_connector_sync",
            _noop_sync,
        )

        task_id, _ = create_sync_task(["google"])
        await run_retry_task(task_id, ["google"])
        task = get_sync_tasks()[task_id]
        assert task["status"] == "completed"

    async def test_retry_failed_sets_status(self, monkeypatch):
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.persist_sync_tasks",
            lambda: None,
        )
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.load_env_vars",
            lambda: {},
        )
        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.settings",
            type("S", (), {"get_codos_path": staticmethod(lambda: Path("/tmp"))})(),
        )

        async def _fail_sync(*args, **kwargs):
            task = args[1]
            key = args[5] if len(args) > 5 else args[0]
            task["connectors"][key] = {"status": "failed", "progress": 0.0, "error": "boom"}

        monkeypatch.setattr(
            "backend.codos_usecases.connector_sync.run_connector_sync",
            _fail_sync,
        )

        task_id, _ = create_sync_task(["slack"])
        await run_retry_task(task_id, ["slack"])
        task = get_sync_tasks()[task_id]
        assert task["status"] == "failed"
