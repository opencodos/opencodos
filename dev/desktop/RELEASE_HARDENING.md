# Desktop Release Hardening (macOS)

This guide is the minimum process for shipping stable desktop builds.

## 1) Preflight

Run before every release build:

```bash
cd /path/to/codos
npm --prefix dev/desktop run preflight:macos
```

What it checks:
- macOS toolchain (`node`, `npm`, `cargo`, `xcodebuild`)
- Tauri config presence
- Rust compile health
- Managed service Python syntax sanity

## 2) Build Artifacts

Local validation build (not notarized):

```bash
cd /path/to/codos
npm --prefix dev/desktop run build:macos
```

Debug build:

```bash
cd /path/to/codos
npm --prefix dev/desktop run build:macos:debug
```

## 3) Runtime Smoke Checks

For every release candidate:
- Launch app and open `#/desktop-settings`
- Confirm runtime network, vault path validation, and service controls
- Verify default port mode and conflict fallback behavior
- Verify `Attach Existing` mode
- Confirm app works with floating runtime panel disabled

## 4) Signing + Notarization (next step)

The repository now includes preflight and build hardening, but signing/notarization is still pending.

When enabling notarized distribution, add:
- Apple Developer signing identity configuration
- CI secrets for certificate + notarization credentials
- Final DMG + update feed release pipeline

## 5) Release Gating

Do not ship if any of these fail:
- preflight command fails
- runtime smoke checks fail
- startup in isolated-port mode regresses
- vault validation/setup flow regresses
