# Architecture

This file describes architectural invariants of the Codos codebase. All new code should follow these guidelines. There might be old code that violates them, but it should be refactored to fulfill them whenever it is touched.

---

## Repository Structure

Top-level directories group code by concern. All relevant code lives under its parent folder.

```
codos/
├── tests/           All the tests (backend and frontend)
├── backend/         Python backend (FastAPI, bots, MCP, CLI)
├── frontend/        Web frontend
├── skills/          Skill definitions (markdown + orchestrator)
├── agents/          Agent prompt configs
├── scripts/         Bootstrap, CI, ops scripts
├── hooks/           Claude Code hooks
```

---

## File paths

User's document vault should be under `~/codos_vault`. This might be made configurable in the future, but for now this path should be considered immutable.

All other files created by application (cache, config files, variables etc) should be stored under ~/.codos

Application code itself can be stored anywhere, there is no expectation for a particular path.

Test paths should mirror source file paths with prefix `tests/`. For example, tests for `backend/codos_ustils/date.py` should be in `tests/backend/codos_ustils/test_date.py`

---

## Distribution mode

Users are expected to install Codos from source by running the bootstrap script.

There are other installation modes planned, but supporting them is currently no-goal.

---

## Application name

The application is called Codos. Early development version was called Atlas - this name is now deprecated and needs to be replaced with Codos everywhere

---

## Single source-of-truth

For each value, there should be a single source-of-truth.

For example, `TELEGRAM_API_HASH` is set in `settings.py` and in no other place.

There should be no cases where same value is set in multiple places, because these places can be edited independently so that they state a different value and application cannot function.

---

## Consistent tooling

All parts of the code should use same tools to solve same problems:

- `uv` for back-end package management
- `FastAPI` for back-end services

---

## Backend: clean architecture

Backend code under `backend/` follows "clean architecture" principles.
It is split into multiple layers, and each layer can only depend (import) from previous layers, not subsequent ones.

```
backend/
├── pyproject.toml        Shared environment
├── __main__.py           Shared dispatcher
├── codos_utils/          Pure utilities, no internal deps, no knowledge of business context
├── codos_models/         Data models, schemas, config classes. Pydantic is a preferred way of handling these
├── codos_adapters/       Adapters to internal and external services (DB, Telegram, GCloud)
├── codos_usecases/       Business logic
└── codos_services/       Lightweight entry points
```
