# Codos Desktop (Tauri)

This workspace packages the existing Codos frontend and backend into a single macOS desktop app.

## Commands

```bash
cd dev/desktop
npm install
npm run dev
```

`npm run dev` starts the frontend via `beforeDevCommand` and runs the Tauri shell.

If you already ran the bootstrap/manual setup from the repo root, you can launch
the desktop app directly via:
```bash
npm --prefix dev/desktop run dev
```

Run headless mode:

```bash
cd dev/desktop
npm run dev -- -- --headless
```

By default, autostart-managed services launch automatically on app startup. You can disable this behavior via:

```bash
CODOS_DESKTOP_AUTO_START_SERVICES=false npm run dev
```

The app also registers a macOS login auto-launch entry (LaunchAgent) and starts in `--headless` mode on login.
Use the tray menu to reopen the window (`Open Codos`) or quit.

By default, desktop runtime uses automatic port selection:

- standard ports (`8767`/`8768`) when free
- first free isolated pair starting from `18767/18768` when conflicts are detected

Release helpers:

```bash
cd dev/desktop
npm run preflight:macos
npm run build:macos
```

See release checklist in `dev/desktop/RELEASE_HARDENING.md`.

## Managed Services

The desktop runtime currently supervises:

- `gateway-backend` (`backend/codos_services/gateway/server.py`) — autostart
- `telegram-agent-api` (`backend/codos_services/telegram_agent/server.py`) — autostart
- `codos-bot` (`backend/codos_services/codos_bot/bot.py`) — manual start
- `telegram-mcp-server` (`backend/codos_services/telegram_mcp/main.py`) — manual start

Service registry is config-driven via:

- `dev/desktop/services.json`

Use it to add/remove managed services and define autostart defaults.
You can also configure per-service crash restart behavior (`restartPolicies`).
You can edit the registry in-app via `#/desktop-settings`.

There is a dedicated in-app runtime settings screen at `#/desktop-settings`.
The floating runtime debug panel is hidden by default; enable with `VITE_SHOW_DESKTOP_RUNTIME_PANEL=true`.

## Runtime paths

Desktop runtime data is stored under:

- `~/Library/Application Support/Codos/`

Managed service logs are written to:

- `~/Library/Application Support/Codos/logs/<service-id>.log`

Runtime desktop settings are persisted in:

- `~/Library/Application Support/Codos/runtime-settings.json`

Vault onboarding:

- `#/desktop-settings` includes a Vault Path section (detect, validate, save).
- Saved vault path is injected into managed services as `VAULT_PATH`.
- First run skips service autostart until a valid vault path is configured.
- You can switch backend mode to "Attach Existing" to use an already-running backend.
