# Architecture

This file describes architectural invariants of the Codos codebase. All new code should follow these guidelines. There might be old code that violates them, but it should be refactored to fulfill them whenever it is touched.

---

## Architecture invariants

### Repository Structure

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

### File paths

User's document vault should be under `~/codos_vault`. This might be made configurable in the future, but for now this path should be considered immutable.

All other files created by application (cache, config files, variables etc) should be stored under ~/.codos

Application code itself can be stored anywhere, there is no expectation for a particular path.

Test paths should mirror source file paths with prefix `tests/`. For example, tests for `backend/codos_utils/date.py` should be in `tests/backend/codos_utils/test_date.py`

---

### Distribution mode

Users are expected to install Codos from source by running the bootstrap script.

There are other installation modes planned, but supporting them is currently no-goal.

---

### Application name

The application is called Codos. Early development version was called Atlas - this name is now deprecated and needs to be replaced with Codos everywhere

---

### Consistent tooling

All parts of the code should use same tools to solve same problems:

- `uv` for back-end package management
- `FastAPI` for back-end services

---

### Backend: clean architecture

Backend code under `backend/` follows "clean architecture" principles.
It is split into multiple layers, and each layer can only depend (import) from previous layers, not subsequent ones.

```
backend/
├── pyproject.toml        Shared environment
├── __main__.py           Shared dispatcher
├── codos_utils/          Pure utilities, no internal deps, no knowledge of business context
├── codos_models/         Data models, schemas, config classes, settings, custom exceptions. Pydantic is preferred
├── codos_adapters/       Adapters to internal and external services (DB, Telegram, GCloud)
├── codos_usecases/       Business logic
└── codos_services/       Lightweight entry points for all runnable services
```

### Universality

Code should not contain references to hardcoded users, for example path `~/gleb`, username `dkhan` and so on

---

## Code quality guidelines

### No magic strings or numbers

Extract hardcoded values to named constants or configuration. `0`, `1`, `-1`, and empty string in obvious contexts are acceptable.

### No duplicated logic

If the same pattern appears in multiple places, extract it to a shared function. Check whether a utility already exists before writing a new one.

### No duplicated values

For each value, there should be a single source-of-truth.

For example, `TELEGRAM_API_HASH` is set in `settings.py` and in no other place.

There should be no cases where same value is set in multiple places, because these places can be edited independently so that they state a different value and application cannot function.

### Meaningful names

- Variables and parameters should reveal intent: `user_count` not `n`
- Booleans read as questions: `is_valid`, `has_permission`
- Functions are verbs: `get_user`, `validate_input`
- No abbreviations unless universally understood

### Comments explain why, not what

Remove commented-out code. Update or remove stale comments that don't match the code.

### Keep functions and files small

- Functions over ~40 lines should be broken up
- Deeply nested code (3+ levels) should be flattened with early returns
- Files over ~400 lines should be broken up

### Typing rules (Python)

- All function parameters and return types must be annotated
- Pydantic models should be used for structured data
- Avoid `Any` — be specific whenever possible
- Python: use `from __future__ import annotations` for forward references
- Introduce custom models to replace primitives nested for 3 or more levels, like `dict[int, list[Callable[None,None,None]]]`
- Introduce type aliases when the unit is ambiguous, for example `Milliseconds: TypeAlias = int` ... `timeout: Milliseconds`
- When deserializing from JSON use Pydantic models to get typed results
- When there is a finite list of possible values, use Enum/StrEnum

### Imports at the top

All imports go at the top of the file, before any other code. No inline imports unless there is a circular dependency that requires it.

### No asserts outside tests

Outside tests, code should handle exceptions using explicit raising, not `assert`

### Only absolute imports

Never import from . or .. - always use absolute paths

### Error handling

Code should not do implicit error handling.
Unexpected values, missing configuration etc should be handled with appropriate `raise`
Avoid generic exception classes - when possible define custom ones so that `catch` blocks know what they are dealing with
