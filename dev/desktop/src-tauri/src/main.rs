use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State, WebviewWindow, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as AutoStartManagerExt};

#[derive(Clone, Copy)]
enum ServiceCommand {
    PythonModule(&'static str, &'static [&'static str]),
}

#[derive(Clone, Copy)]
struct ManagedServiceConfig {
    id: &'static str,
    name: &'static str,
    cwd_relative: &'static str,
    bundle_relative: &'static str,
    command: ServiceCommand,
    bundle_command: Option<ServiceCommand>,
    autostart: bool,
    restart_on_crash: bool,
    max_restart_attempts: Option<u32>,
}

const SERVICE_CATALOG: [ManagedServiceConfig; 4] = [
    ManagedServiceConfig {
        id: "connector-backend",
        name: "Connector Backend",
        cwd_relative: ".",
        bundle_relative: "services",
        command: ServiceCommand::PythonModule("backend", &["connector"]),
        bundle_command: None,
        autostart: true,
        restart_on_crash: true,
        max_restart_attempts: Some(10),
    },
    ManagedServiceConfig {
        id: "telegram-agent-api",
        name: "Telegram Agent API",
        cwd_relative: ".",
        bundle_relative: "services",
        command: ServiceCommand::PythonModule("backend", &["telegram-agent", "server"]),
        bundle_command: None,
        autostart: true,
        restart_on_crash: true,
        max_restart_attempts: Some(10),
    },
    ManagedServiceConfig {
        id: "atlas-bot",
        name: "Atlas Bot",
        cwd_relative: ".",
        bundle_relative: "services",
        command: ServiceCommand::PythonModule("backend", &["atlas-bot"]),
        bundle_command: None,
        autostart: false,
        restart_on_crash: false,
        max_restart_attempts: None,
    },
    ManagedServiceConfig {
        id: "telegram-mcp-server",
        name: "Telegram MCP Server",
        cwd_relative: ".",
        bundle_relative: "services",
        command: ServiceCommand::PythonModule("backend", &["telegram-mcp"]),
        bundle_command: None,
        autostart: false,
        restart_on_crash: false,
        max_restart_attempts: None,
    },
];

const SERVICE_REGISTRY_RELATIVE_PATH: &str = "dev/desktop/services.json";
const MAX_RESTART_BACKOFF_SECONDS: u64 = 60;
const MAX_SERVICE_EVENTS: usize = 200;
const DEFAULT_BACKEND_PORT: u16 = 8767;
const DEFAULT_TELEGRAM_AGENT_PORT: u16 = 8768;
const CONNECTOR_BACKEND_SERVICE_ID: &str = "connector-backend";
const TELEGRAM_AGENT_SERVICE_ID: &str = "telegram-agent-api";

#[derive(Default)]
struct ServiceManager {
    state: Mutex<ServiceState>,
}

struct ServiceState {
    services: HashMap<String, ManagedServiceRuntime>,
    service_registry: ServiceRegistryConfig,
    runtime_settings: RuntimeSettings,
    runtime_network: RuntimeNetwork,
    events: VecDeque<ServiceEvent>,
}

impl Default for ServiceState {
    fn default() -> Self {
        let service_registry = load_service_registry();
        let mut services = HashMap::new();
        for config in materialize_managed_service_configs(&service_registry) {
            services.insert(config.id.to_string(), ManagedServiceRuntime::new(config));
        }
        Self {
            services,
            service_registry,
            runtime_settings: RuntimeSettings::default(),
            runtime_network: RuntimeNetwork::default(),
            events: VecDeque::new(),
        }
    }
}

struct ManagedServiceRuntime {
    config: ManagedServiceConfig,
    process: Option<ManagedServiceProcess>,
    log_path: Option<PathBuf>,
    last_error: Option<String>,
    should_run: bool,
    restart_attempts: u32,
    next_restart_at_ms: Option<u64>,
}

impl ManagedServiceRuntime {
    fn new(config: ManagedServiceConfig) -> Self {
        Self {
            config,
            process: None,
            log_path: None,
            last_error: None,
            should_run: false,
            restart_attempts: 0,
            next_restart_at_ms: None,
        }
    }
}

struct ManagedServiceProcess {
    child: Child,
    started_at_ms: u64,
}

/// Kill a service process and its entire process group (handles PyInstaller forks).
fn kill_process_tree(process: &mut ManagedServiceProcess) {
    let pid = process.child.id() as libc::pid_t;
    // Kill the process group (negative PID = group). Each child is a group
    // leader via setsid() in pre_exec, so this catches all descendants.
    unsafe { libc::kill(-pid, libc::SIGTERM) };
    // Also kill the direct child in case setsid didn't apply
    let _ = process.child.kill();
    let _ = process.child.wait();
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ServiceStatus {
    id: String,
    name: String,
    autostart: bool,
    restart_on_crash: bool,
    max_restart_attempts: Option<u32>,
    restart_attempts: u32,
    next_restart_at_ms: Option<u64>,
    running: bool,
    pid: Option<u32>,
    started_at_ms: Option<u64>,
    log_path: Option<String>,
    last_error: Option<String>,
    managed_externally: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ServiceEvent {
    timestamp_ms: u64,
    service_id: String,
    level: String,
    message: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(default, rename_all = "camelCase")]
struct RuntimeSettings {
    auto_start_services_on_launch: bool,
    launch_at_login_enabled: bool,
    backend_mode: BackendMode,
}

impl Default for RuntimeSettings {
    fn default() -> Self {
        Self {
            auto_start_services_on_launch: true,
            launch_at_login_enabled: true,
            backend_mode: BackendMode::Managed,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeSettingsPatch {
    auto_start_services_on_launch: Option<bool>,
    launch_at_login_enabled: Option<bool>,
    backend_mode: Option<BackendMode>,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum BackendMode {
    Managed,
    AttachExisting,
}

#[derive(Clone)]
struct RuntimeNetwork {
    backend_port: u16,
    telegram_agent_port: u16,
    uses_isolated_ports: bool,
    port_conflict_detected: bool,
    attach_existing_backend: bool,
}

impl RuntimeNetwork {
    fn backend_base_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.backend_port)
    }

    fn backend_ws_url(&self) -> String {
        format!("ws://127.0.0.1:{}", self.backend_port)
    }
}

impl Default for RuntimeNetwork {
    fn default() -> Self {
        Self {
            backend_port: DEFAULT_BACKEND_PORT,
            telegram_agent_port: DEFAULT_TELEGRAM_AGENT_PORT,
            uses_isolated_ports: false,
            port_conflict_detected: false,
            attach_existing_backend: false,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultPathValidationResult {
    path: String,
    exists: bool,
    is_directory: bool,
    readable: bool,
    writable: bool,
    valid: bool,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeBootstrapStatus {
    backend_base_url: String,
    backend_ws_url: String,
    backend_port: u16,
    telegram_agent_port: u16,
    uses_isolated_ports: bool,
    port_conflict_detected: bool,
    attach_to_existing_backend: bool,
    atlas_api_key: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ServiceRegistryConfig {
    enabled_services: Vec<String>,
    autostart_services: Vec<String>,
    restart_policies: HashMap<String, ServiceRestartPolicyConfig>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ServiceRestartPolicyConfig {
    enabled: bool,
    max_attempts: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServiceRegistryFileConfig {
    enabled_services: Option<Vec<String>>,
    autostart_services: Option<Vec<String>>,
    restart_policies: Option<HashMap<String, ServiceRestartPolicyFileConfig>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServiceRestartPolicyFileConfig {
    enabled: Option<bool>,
    max_attempts: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceCatalogEntry {
    id: String,
    name: String,
    cwd_relative: String,
    bundle_relative: String,
    default_autostart: bool,
    default_restart_on_crash: bool,
    default_max_restart_attempts: Option<u32>,
}

#[tauri::command]
fn list_services(manager: State<ServiceManager>) -> Result<Vec<ServiceStatus>, String> {
    let mut state = manager
        .state
        .lock()
        .map_err(|_| "service state lock poisoned".to_string())?;

    Ok(list_service_statuses(&mut state))
}

#[tauri::command]
fn get_service_events(
    manager: State<ServiceManager>,
    limit: Option<usize>,
) -> Result<Vec<ServiceEvent>, String> {
    let state = manager
        .state
        .lock()
        .map_err(|_| "service state lock poisoned".to_string())?;

    let take_limit = limit.unwrap_or(50);
    Ok(state
        .events
        .iter()
        .rev()
        .take(take_limit)
        .cloned()
        .collect())
}

#[tauri::command]
fn start_service(
    app: AppHandle,
    manager: State<ServiceManager>,
    service_id: String,
) -> Result<ServiceStatus, String> {
    start_service_by_id(&app, &manager, &service_id)
}

#[tauri::command]
fn stop_service(
    manager: State<ServiceManager>,
    service_id: String,
) -> Result<ServiceStatus, String> {
    stop_service_by_id(&manager, &service_id)
}

#[tauri::command]
fn start_autostart_services(
    app: AppHandle,
    manager: State<ServiceManager>,
) -> Result<Vec<ServiceStatus>, String> {
    let mut state = manager
        .state
        .lock()
        .map_err(|_| "service state lock poisoned".to_string())?;

    if !is_vault_ready() {
        return Err(
            "vault path is not configured or not writable; open desktop settings first".to_string(),
        );
    }

    let mut autostart_ids: Vec<String> = state
        .services
        .values()
        .filter(|runtime| runtime.config.autostart)
        .map(|runtime| runtime.config.id.to_string())
        .collect();
    autostart_ids.sort();
    let mut started_statuses: Vec<ServiceStatus> = Vec::new();
    let runtime_network = state.runtime_network.clone();

    for service_id in autostart_ids {
        match start_service_inner(&app, &mut state, &service_id) {
            Ok(status) => started_statuses.push(status),
            Err(error) => {
                if let Some(runtime) = state.services.get_mut(&service_id) {
                    runtime.last_error = Some(error.clone());
                    started_statuses.push(service_status_from_runtime(runtime, &runtime_network));
                }
                record_event(
                    &mut state,
                    &service_id,
                    "error",
                    format!("autostart failed: {error}"),
                );
            }
        }
    }

    Ok(started_statuses)
}

#[tauri::command]
fn start_backend(app: AppHandle, manager: State<ServiceManager>) -> Result<ServiceStatus, String> {
    start_service_by_id(&app, &manager, "connector-backend")
}

#[tauri::command]
fn stop_backend(manager: State<ServiceManager>) -> Result<ServiceStatus, String> {
    stop_service_by_id(&manager, "connector-backend")
}

#[tauri::command]
fn backend_status(manager: State<ServiceManager>) -> Result<ServiceStatus, String> {
    service_status_by_id(&manager, "connector-backend")
}

#[tauri::command]
fn show_main_window(app: AppHandle) -> Result<(), String> {
    show_main_window_internal(&app)
}

#[tauri::command]
fn get_runtime_settings(manager: State<ServiceManager>) -> Result<RuntimeSettings, String> {
    let state = manager
        .state
        .lock()
        .map_err(|_| "service state lock poisoned".to_string())?;

    Ok(state.runtime_settings.clone())
}

#[tauri::command]
fn update_runtime_settings(
    app: AppHandle,
    manager: State<ServiceManager>,
    patch: RuntimeSettingsPatch,
) -> Result<RuntimeSettings, String> {
    let updated_settings = {
        let mut state = manager
            .state
            .lock()
            .map_err(|_| "service state lock poisoned".to_string())?;
        let previous_network = state.runtime_network.clone();

        if let Some(auto_start) = patch.auto_start_services_on_launch {
            state.runtime_settings.auto_start_services_on_launch = auto_start;
        }
        if let Some(launch_at_login) = patch.launch_at_login_enabled {
            state.runtime_settings.launch_at_login_enabled = launch_at_login;
        }
        if let Some(backend_mode) = patch.backend_mode {
            state.runtime_settings.backend_mode = backend_mode;
            if backend_mode == BackendMode::AttachExisting {
                if let Some(runtime) = state.services.get_mut(CONNECTOR_BACKEND_SERVICE_ID) {
                    if let Some(mut process) = runtime.process.take() {
                        kill_process_tree(&mut process);
                    }
                    runtime.should_run = false;
                    runtime.restart_attempts = 0;
                    runtime.next_restart_at_ms = None;
                    runtime.last_error = None;
                }
            }
        }
        state.runtime_network = compute_runtime_network(&state.runtime_settings);
        if previous_network.backend_port != state.runtime_network.backend_port
            || previous_network.telegram_agent_port != state.runtime_network.telegram_agent_port
            || previous_network.attach_existing_backend
                != state.runtime_network.attach_existing_backend
        {
            let network_message = format!(
                "runtime network updated: backend={} telegram={} mode={}",
                state.runtime_network.backend_port,
                state.runtime_network.telegram_agent_port,
                if state.runtime_network.attach_existing_backend {
                    "attach-existing"
                } else {
                    "managed"
                }
            );
            record_event(
                &mut state,
                CONNECTOR_BACKEND_SERVICE_ID,
                "info",
                network_message,
            );
        }

        state.runtime_settings.clone()
    };

    sync_launch_at_login_setting(&app, updated_settings.launch_at_login_enabled)?;

    Ok(updated_settings)
}

#[tauri::command]
fn get_default_vault_path() -> Option<String> {
    detect_default_vault_path()
}

#[tauri::command]
fn validate_vault_path(path: String) -> VaultPathValidationResult {
    validate_vault_path_inner(&path)
}

#[tauri::command]
fn get_runtime_bootstrap_status(
    app: AppHandle,
    manager: State<ServiceManager>,
) -> Result<RuntimeBootstrapStatus, String> {
    let state = manager
        .state
        .lock()
        .map_err(|_| "service state lock poisoned".to_string())?;

    let api_key = ensure_atlas_api_key(&app).unwrap_or_default();

    Ok(RuntimeBootstrapStatus {
        backend_base_url: state.runtime_network.backend_base_url(),
        backend_ws_url: state.runtime_network.backend_ws_url(),
        backend_port: state.runtime_network.backend_port,
        telegram_agent_port: state.runtime_network.telegram_agent_port,
        uses_isolated_ports: state.runtime_network.uses_isolated_ports,
        port_conflict_detected: state.runtime_network.port_conflict_detected,
        attach_to_existing_backend: state.runtime_network.attach_existing_backend,
        atlas_api_key: api_key,
    })
}

#[tauri::command]
fn get_service_registry(manager: State<ServiceManager>) -> Result<ServiceRegistryConfig, String> {
    let state = manager
        .state
        .lock()
        .map_err(|_| "service state lock poisoned".to_string())?;
    Ok(state.service_registry.clone())
}

#[tauri::command]
fn get_service_catalog() -> Vec<ServiceCatalogEntry> {
    SERVICE_CATALOG
        .iter()
        .map(|config| ServiceCatalogEntry {
            id: config.id.to_string(),
            name: config.name.to_string(),
            cwd_relative: config.cwd_relative.to_string(),
            bundle_relative: config.bundle_relative.to_string(),
            default_autostart: config.autostart,
            default_restart_on_crash: config.restart_on_crash,
            default_max_restart_attempts: config.max_restart_attempts,
        })
        .collect()
}

#[tauri::command]
fn update_service_registry(
    manager: State<ServiceManager>,
    registry: ServiceRegistryConfig,
) -> Result<ServiceRegistryConfig, String> {
    validate_service_registry(&registry)?;
    save_service_registry(&registry)?;

    let mut state = manager
        .state
        .lock()
        .map_err(|_| "service state lock poisoned".to_string())?;

    let next_configs = materialize_managed_service_configs(&registry);
    let mut next_by_id: HashMap<String, ManagedServiceConfig> = HashMap::new();
    for config in next_configs {
        next_by_id.insert(config.id.to_string(), config);
    }

    let existing_ids: Vec<String> = state.services.keys().cloned().collect();
    for existing_id in &existing_ids {
        if !next_by_id.contains_key(existing_id) {
            if let Some(mut runtime) = state.services.remove(existing_id) {
                if let Some(mut process) = runtime.process.take() {
                    kill_process_tree(&mut process);
                }
                record_event(
                    &mut state,
                    existing_id,
                    "info",
                    "service disabled via registry",
                );
            }
        }
    }

    for (service_id, config) in &next_by_id {
        if let Some(runtime) = state.services.get_mut(service_id) {
            runtime.config = *config;
            if !runtime.config.restart_on_crash {
                runtime.restart_attempts = 0;
                runtime.next_restart_at_ms = None;
            }
        } else {
            state
                .services
                .insert(service_id.clone(), ManagedServiceRuntime::new(*config));
            record_event(
                &mut state,
                service_id,
                "info",
                "service enabled via registry",
            );
        }
    }

    state.service_registry = registry.clone();
    Ok(registry)
}

fn start_service_by_id(
    app: &AppHandle,
    manager: &State<ServiceManager>,
    service_id: &str,
) -> Result<ServiceStatus, String> {
    let mut state = manager
        .state
        .lock()
        .map_err(|_| "service state lock poisoned".to_string())?;

    match start_service_inner(app, &mut state, service_id) {
        Ok(status) => {
            record_event(
                &mut state,
                service_id,
                "info",
                format!("service started (pid={})", status.pid.unwrap_or(0)),
            );
            Ok(status)
        }
        Err(error) => {
            record_event(
                &mut state,
                service_id,
                "error",
                format!("start failed: {error}"),
            );
            Err(error)
        }
    }
}

fn stop_service_by_id(
    manager: &State<ServiceManager>,
    service_id: &str,
) -> Result<ServiceStatus, String> {
    let mut state = manager
        .state
        .lock()
        .map_err(|_| "service state lock poisoned".to_string())?;

    match stop_service_inner(&mut state, service_id) {
        Ok(status) => {
            record_event(&mut state, service_id, "info", "service stopped");
            Ok(status)
        }
        Err(error) => {
            record_event(
                &mut state,
                service_id,
                "error",
                format!("stop failed: {error}"),
            );
            Err(error)
        }
    }
}

fn service_status_by_id(
    manager: &State<ServiceManager>,
    service_id: &str,
) -> Result<ServiceStatus, String> {
    let mut state = manager
        .state
        .lock()
        .map_err(|_| "service state lock poisoned".to_string())?;
    let runtime_network = state.runtime_network.clone();

    let (status, crash_message) = {
        let runtime = state
            .services
            .get_mut(service_id)
            .ok_or_else(|| format!("unknown service: {service_id}"))?;
        let crash = refresh_runtime_process_state(runtime);
        (
            service_status_from_runtime(runtime, &runtime_network),
            crash,
        )
    };

    if let Some(message) = crash_message {
        record_event(&mut state, service_id, "warn", message);
    }

    Ok(status)
}

fn start_service_inner(
    app: &AppHandle,
    state: &mut ServiceState,
    service_id: &str,
) -> Result<ServiceStatus, String> {
    if service_id == CONNECTOR_BACKEND_SERVICE_ID && state.runtime_network.attach_existing_backend {
        let runtime = state
            .services
            .get_mut(service_id)
            .ok_or_else(|| format!("unknown service: {service_id}"))?;
        runtime.should_run = false;
        runtime.restart_attempts = 0;
        runtime.next_restart_at_ms = None;
        runtime.last_error = if is_port_open(state.runtime_network.backend_port) {
            None
        } else {
            Some(format!(
                "external backend not reachable at {}",
                state.runtime_network.backend_base_url()
            ))
        };
        return Ok(service_status_from_runtime(runtime, &state.runtime_network));
    }

    // Check for port conflicts before attempting to start.
    // If the port is occupied (orphan from previous session, dev bootstrap, etc.),
    // kill the occupant first — mirrors bootstrap.sh's kill_port behavior.
    if service_id == CONNECTOR_BACKEND_SERVICE_ID
        && !is_port_available(state.runtime_network.backend_port)
    {
        let port = state.runtime_network.backend_port;
        record_event(
            state,
            service_id,
            "warn",
            format!("port {port} occupied, killing occupants"),
        );
        kill_port_occupants(port);
        if !is_port_available(port) {
            let runtime = state
                .services
                .get_mut(service_id)
                .ok_or_else(|| format!("unknown service: {service_id}"))?;
            let error_msg = format!(
                "Port {port} is still in use after cleanup. Please close other applications using this port and restart."
            );
            runtime.last_error = Some(error_msg.clone());
            return Err(error_msg);
        }
    }
    if service_id == TELEGRAM_AGENT_SERVICE_ID
        && !is_port_available(state.runtime_network.telegram_agent_port)
    {
        let port = state.runtime_network.telegram_agent_port;
        record_event(
            state,
            service_id,
            "warn",
            format!("port {port} occupied, killing occupants"),
        );
        kill_port_occupants(port);
        if !is_port_available(port) {
            let runtime = state
                .services
                .get_mut(service_id)
                .ok_or_else(|| format!("unknown service: {service_id}"))?;
            let error_msg = format!(
                "Port {port} is still in use after cleanup. Please close other applications using this port and restart."
            );
            runtime.last_error = Some(error_msg.clone());
            return Err(error_msg);
        }
    }

    let crash_message: Option<String>;
    let mut already_running_status: Option<ServiceStatus> = None;
    {
        let runtime = state
            .services
            .get_mut(service_id)
            .ok_or_else(|| format!("unknown service: {service_id}"))?;

        crash_message = refresh_runtime_process_state(runtime);
        if runtime.process.is_some() {
            runtime.should_run = true;
            already_running_status =
                Some(service_status_from_runtime(runtime, &state.runtime_network));
        }
    }

    if let Some(message) = crash_message {
        record_event(state, service_id, "warn", message);
    }
    if let Some(status) = already_running_status {
        return Ok(status);
    }

    let log_dir = ensure_log_dir(app)?;
    let vault_path = detect_default_vault_path();

    let runtime = state
        .services
        .get_mut(service_id)
        .ok_or_else(|| format!("unknown service: {service_id}"))?;

    // Resolve service directory: bundle mode uses resource_dir, dev mode uses codos_root
    let service_dir = if is_bundle_mode(app) {
        let resource_dir = bundle_resource_dir(app)?;
        resource_dir.join(runtime.config.bundle_relative)
    } else {
        let codos_root = resolve_codos_root()?;
        codos_root.join(runtime.config.cwd_relative)
    };
    let codos_root = if is_bundle_mode(app) {
        bundle_resource_dir(app)?
    } else {
        resolve_codos_root()?
    };

    if !service_dir.exists() {
        let message = format!(
            "service working directory not found for {}: {}",
            runtime.config.id,
            service_dir.display()
        );
        runtime.last_error = Some(message.clone());
        return Err(message);
    }

    let log_path = log_dir.join(format!("{}.log", runtime.config.id));
    let stdout_log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|err| {
            format!(
                "failed to open log file for service {}: {err}",
                runtime.config.id
            )
        })?;
    let stderr_log = stdout_log.try_clone().map_err(|err| {
        format!(
            "failed to clone log handle for service {}: {err}",
            runtime.config.id
        )
    })?;

    let mut command = build_service_command(
        runtime,
        &service_dir,
        &codos_root,
        vault_path.as_deref(),
        &state.runtime_network,
        app,
    )?;
    // SAFETY: setsid() is async-signal-safe. It makes the child a process group
    // leader so we can kill the entire tree (including PyInstaller forks) on exit.
    unsafe {
        command.pre_exec(|| {
            libc::setsid();
            Ok(())
        });
    }
    let child = command
        .stdout(Stdio::from(stdout_log))
        .stderr(Stdio::from(stderr_log))
        .spawn()
        .map_err(|err| format!("failed to start service {}: {err}", runtime.config.id))?;

    runtime.process = Some(ManagedServiceProcess {
        child,
        started_at_ms: unix_now_ms(),
    });
    runtime.log_path = Some(log_path);
    runtime.last_error = None;
    runtime.should_run = true;
    runtime.restart_attempts = 0;
    runtime.next_restart_at_ms = None;

    Ok(service_status_from_runtime(runtime, &state.runtime_network))
}

fn stop_service_inner(state: &mut ServiceState, service_id: &str) -> Result<ServiceStatus, String> {
    if service_id == CONNECTOR_BACKEND_SERVICE_ID && state.runtime_network.attach_existing_backend {
        let runtime = state
            .services
            .get_mut(service_id)
            .ok_or_else(|| format!("unknown service: {service_id}"))?;
        runtime.should_run = false;
        runtime.restart_attempts = 0;
        runtime.next_restart_at_ms = None;
        return Ok(service_status_from_runtime(runtime, &state.runtime_network));
    }

    let crash_message: Option<String>;
    let stop_error: Option<String> = None;

    {
        let runtime = state
            .services
            .get_mut(service_id)
            .ok_or_else(|| format!("unknown service: {service_id}"))?;

        crash_message = refresh_runtime_process_state(runtime);

        if let Some(mut process) = runtime.process.take() {
            kill_process_tree(&mut process);
        }

        runtime.should_run = false;
        runtime.restart_attempts = 0;
        runtime.next_restart_at_ms = None;
    }

    if let Some(message) = crash_message {
        record_event(state, service_id, "warn", message);
    }

    if let Some(error) = stop_error {
        return Err(error);
    }

    let runtime = state
        .services
        .get(service_id)
        .ok_or_else(|| format!("unknown service: {service_id}"))?;
    Ok(service_status_from_runtime(runtime, &state.runtime_network))
}

fn build_service_command(
    runtime: &ManagedServiceRuntime,
    service_dir: &Path,
    codos_root: &Path,
    vault_path: Option<&str>,
    runtime_network: &RuntimeNetwork,
    app: &AppHandle,
) -> Result<Command, String> {
    // In bundle mode, prefer bundle_command if available
    let effective_command = if is_bundle_mode(app) {
        runtime
            .config
            .bundle_command
            .unwrap_or(runtime.config.command)
    } else {
        runtime.config.command
    };

    let ServiceCommand::PythonModule(module, args) = effective_command;

    let python_binary = resolve_python_binary(codos_root, Some(app));
    let mut command = Command::new(python_binary);
    command.args(["-m", module]);
    command.args(args.iter());
    command.current_dir(codos_root);

    // Set PYTHONPATH so `import backend` resolves
    let python_path = if is_bundle_mode(app) {
        service_dir.to_path_buf() // {resource_dir}/services
    } else {
        codos_root.join("src") // {codos_root}/src
    };
    command.env("PYTHONPATH", &python_path);

    // Common env vars for all services
    let app_version = app.config().version.clone().unwrap_or_default();
    command
        .env("PYTHONUNBUFFERED", "1")
        .env("CODOS_ROOT", codos_root)
        .env("CODOS_VERSION", &app_version);

    // Bundle-mode env vars
    if is_bundle_mode(app) {
        command.env("PYTHONDONTWRITEBYTECODE", "1");
        if let Ok(resource_dir) = bundle_resource_dir(app) {
            command.env("BUNDLE_ROOT", &resource_dir);
            command.env("PYTHONHOME", resource_dir.join("python"));
            command.env("ATLAS_BUNDLED_BUN", resource_dir.join("bun/bin/bun"));
            command.env("ATLAS_BUNDLED_CLAUDE", resource_dir.join("bun/bin/claude"));
        }
        if let Ok(secrets_path) = app_secrets_env_path(app) {
            command.env("ATLAS_ENV_FILE", &secrets_path);
        }
        // Use ~/.codos/ as writable data directory
        let atlas_data_dir = home_dir().unwrap_or_default().join(".codos");
        command.env("ATLAS_DATA_DIR", &atlas_data_dir);
        if let Ok(api_key) = ensure_atlas_api_key(app) {
            command.env("ATLAS_API_KEY", &api_key);
        }
    }

    // Service-specific env vars
    if runtime.config.id == CONNECTOR_BACKEND_SERVICE_ID {
        command
            .env(
                "ATLAS_BACKEND_PORT",
                runtime_network.backend_port.to_string(),
            )
            .env(
                "TELEGRAM_AGENT_URL",
                format!("http://127.0.0.1:{}", runtime_network.telegram_agent_port),
            )
            .env(
                "TELEGRAM_AGENT_PORT",
                runtime_network.telegram_agent_port.to_string(),
            );
    }
    if runtime.config.id == TELEGRAM_AGENT_SERVICE_ID {
        command.env(
            "TELEGRAM_AGENT_PORT",
            runtime_network.telegram_agent_port.to_string(),
        );
    }

    if let Some(path) = vault_path {
        if !path.trim().is_empty() {
            command.env("VAULT_PATH", path);
        }
    }

    Ok(command)
}

fn default_service_registry() -> ServiceRegistryConfig {
    let enabled_services = SERVICE_CATALOG
        .iter()
        .map(|config| config.id.to_string())
        .collect::<Vec<_>>();
    let autostart_services = SERVICE_CATALOG
        .iter()
        .filter(|config| config.autostart)
        .map(|config| config.id.to_string())
        .collect::<Vec<_>>();
    let restart_policies = SERVICE_CATALOG
        .iter()
        .map(|config| {
            (
                config.id.to_string(),
                ServiceRestartPolicyConfig {
                    enabled: config.restart_on_crash,
                    max_attempts: config.max_restart_attempts,
                },
            )
        })
        .collect::<HashMap<_, _>>();

    ServiceRegistryConfig {
        enabled_services,
        autostart_services,
        restart_policies,
    }
}

fn service_registry_path() -> Result<PathBuf, String> {
    let codos_root = resolve_codos_root()?;
    Ok(codos_root.join(SERVICE_REGISTRY_RELATIVE_PATH))
}

fn load_service_registry() -> ServiceRegistryConfig {
    let mut registry = default_service_registry();
    let path = match service_registry_path() {
        Ok(path) => path,
        Err(_) => return registry,
    };
    let raw = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(_) => return registry,
    };
    let parsed: ServiceRegistryFileConfig = match serde_json::from_str(&raw) {
        Ok(config) => config,
        Err(_) => return registry,
    };

    let known_ids = SERVICE_CATALOG
        .iter()
        .map(|config| config.id.to_string())
        .collect::<HashSet<_>>();

    if let Some(enabled_services) = parsed.enabled_services {
        registry.enabled_services = enabled_services
            .into_iter()
            .filter(|service_id| known_ids.contains(service_id))
            .collect();
    }

    if let Some(autostart_services) = parsed.autostart_services {
        registry.autostart_services = autostart_services
            .into_iter()
            .filter(|service_id| known_ids.contains(service_id))
            .collect();
    }

    if let Some(restart_policies) = parsed.restart_policies {
        for (service_id, policy) in restart_policies {
            if !known_ids.contains(&service_id) {
                continue;
            }

            let base_policy = registry
                .restart_policies
                .get(&service_id)
                .cloned()
                .unwrap_or(ServiceRestartPolicyConfig {
                    enabled: false,
                    max_attempts: None,
                });
            registry.restart_policies.insert(
                service_id,
                ServiceRestartPolicyConfig {
                    enabled: policy.enabled.unwrap_or(base_policy.enabled),
                    max_attempts: policy.max_attempts.or(base_policy.max_attempts),
                },
            );
        }
    }

    registry
}

fn materialize_managed_service_configs(
    registry: &ServiceRegistryConfig,
) -> Vec<ManagedServiceConfig> {
    let enabled_ids = registry
        .enabled_services
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let autostart_ids = registry
        .autostart_services
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();

    SERVICE_CATALOG
        .iter()
        .filter_map(|base| {
            if !enabled_ids.contains(base.id) {
                return None;
            }

            let mut config = *base;
            config.autostart = autostart_ids.contains(base.id);

            if let Some(policy) = registry.restart_policies.get(base.id) {
                config.restart_on_crash = policy.enabled;
                config.max_restart_attempts = policy.max_attempts;
            }

            Some(config)
        })
        .collect()
}

fn validate_service_registry(registry: &ServiceRegistryConfig) -> Result<(), String> {
    let known_ids = SERVICE_CATALOG
        .iter()
        .map(|config| config.id.to_string())
        .collect::<HashSet<_>>();

    for service_id in &registry.enabled_services {
        if !known_ids.contains(service_id) {
            return Err(format!("unknown enabled service id: {service_id}"));
        }
    }
    for service_id in &registry.autostart_services {
        if !known_ids.contains(service_id) {
            return Err(format!("unknown autostart service id: {service_id}"));
        }
    }
    for service_id in registry.restart_policies.keys() {
        if !known_ids.contains(service_id) {
            return Err(format!("unknown restart policy service id: {service_id}"));
        }
    }
    for service_id in &registry.autostart_services {
        if !registry.enabled_services.contains(service_id) {
            return Err(format!(
                "autostart service must also be enabled: {service_id}"
            ));
        }
    }

    Ok(())
}

fn save_service_registry(registry: &ServiceRegistryConfig) -> Result<(), String> {
    let path = service_registry_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("failed to create registry directory: {err}"))?;
    }

    let serialized = serde_json::to_string_pretty(registry)
        .map_err(|err| format!("failed to serialize service registry: {err}"))?;
    fs::write(path, serialized).map_err(|err| format!("failed to persist service registry: {err}"))
}

fn list_service_statuses(state: &mut ServiceState) -> Vec<ServiceStatus> {
    let mut service_ids: Vec<String> = state.services.keys().cloned().collect();
    service_ids.sort();

    let mut statuses: Vec<ServiceStatus> = Vec::new();
    let mut events: Vec<(String, String)> = Vec::new();
    for service_id in service_ids {
        if let Some(runtime) = state.services.get_mut(&service_id) {
            if let Some(message) = refresh_runtime_process_state(runtime) {
                events.push((service_id.clone(), message));
            }
            statuses.push(service_status_from_runtime(runtime, &state.runtime_network));
        }
    }
    for (service_id, message) in events {
        record_event(state, &service_id, "warn", message);
    }

    statuses
}

fn service_status_from_runtime(
    runtime: &ManagedServiceRuntime,
    runtime_network: &RuntimeNetwork,
) -> ServiceStatus {
    let managed_externally = runtime.config.id == CONNECTOR_BACKEND_SERVICE_ID
        && runtime_network.attach_existing_backend;
    let running = runtime.process.is_some()
        || (managed_externally && is_port_open(runtime_network.backend_port));

    ServiceStatus {
        id: runtime.config.id.to_string(),
        name: runtime.config.name.to_string(),
        autostart: runtime.config.autostart,
        restart_on_crash: runtime.config.restart_on_crash,
        max_restart_attempts: runtime.config.max_restart_attempts,
        restart_attempts: runtime.restart_attempts,
        next_restart_at_ms: runtime.next_restart_at_ms,
        running,
        pid: runtime.process.as_ref().map(|process| process.child.id()),
        started_at_ms: runtime
            .process
            .as_ref()
            .map(|process| process.started_at_ms),
        log_path: runtime
            .log_path
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        last_error: runtime.last_error.clone(),
        managed_externally,
    }
}

fn record_event(
    state: &mut ServiceState,
    service_id: &str,
    level: &str,
    message: impl Into<String>,
) {
    let entry = ServiceEvent {
        timestamp_ms: unix_now_ms(),
        service_id: service_id.to_string(),
        level: level.to_string(),
        message: message.into(),
    };
    state.events.push_back(entry);

    while state.events.len() > MAX_SERVICE_EVENTS {
        state.events.pop_front();
    }
}

fn refresh_runtime_process_state(runtime: &mut ManagedServiceRuntime) -> Option<String> {
    let mut exit_message: Option<String> = None;

    if let Some(process) = runtime.process.as_mut() {
        match process.child.try_wait() {
            Ok(Some(status)) => {
                let backoff_ms = restart_backoff_ms(runtime.restart_attempts);
                runtime.next_restart_at_ms = Some(unix_now_ms() + backoff_ms);
                runtime.restart_attempts = runtime.restart_attempts.saturating_add(1);
                exit_message = Some(format!(
                    "service exited with status: {status}; retry in {}s",
                    backoff_ms / 1000
                ));
            }
            Ok(None) => {}
            Err(err) => {
                let backoff_ms = restart_backoff_ms(runtime.restart_attempts);
                runtime.next_restart_at_ms = Some(unix_now_ms() + backoff_ms);
                runtime.restart_attempts = runtime.restart_attempts.saturating_add(1);
                exit_message = Some(format!(
                    "service status check failed: {err}; retry in {}s",
                    backoff_ms / 1000
                ));
            }
        }
    }

    if let Some(message) = exit_message {
        runtime.process = None;
        runtime.last_error = Some(message.clone());
        return Some(message);
    }

    None
}

fn resolve_codos_root() -> Result<PathBuf, String> {
    // 1. Check explicit CODOS_ROOT env var
    if let Ok(explicit_root) = std::env::var("CODOS_ROOT") {
        let root = PathBuf::from(explicit_root);
        if root.join("src/backend/connector/server.py").exists() {
            return Ok(root);
        }
    }

    // 2. Check ~/.codos/paths.json for codosPath
    if let Some(home) = home_dir() {
        let atlas_paths = home.join(".codos/paths.json");
        if let Ok(raw) = fs::read_to_string(&atlas_paths) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) {
                if let Some(codos_path) = json.get("codosPath").and_then(|v| v.as_str()) {
                    let root = PathBuf::from(codos_path);
                    if root.join("src/backend/connector/server.py").exists() {
                        return Ok(root);
                    }
                }
            }
        }
    }

    // 3. Probe from cwd and exe location (for dev mode)
    let mut roots_to_probe: Vec<PathBuf> = Vec::new();

    if let Ok(cwd) = std::env::current_dir() {
        roots_to_probe.push(cwd);
    }

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            roots_to_probe.push(parent.to_path_buf());
        }
    }

    for root in roots_to_probe {
        for candidate in root.ancestors() {
            let marker = candidate.join("src/backend/connector/server.py");
            if marker.exists() {
                return Ok(candidate.to_path_buf());
            }
        }
    }

    Err("unable to resolve CODOS_ROOT; set CODOS_ROOT env var or configure codosPath in ~/.codos/paths.json".to_string())
}

fn is_bundle_mode(_app: &AppHandle) -> bool {
    std::env::current_exe()
        .map(|exe| exe.to_string_lossy().contains(".app/Contents/"))
        .unwrap_or(false)
}

fn bundle_resource_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .resource_dir()
        .map_err(|err| format!("failed to resolve resource directory: {err}"))?;
    Ok(base.join("resources"))
}

fn app_secrets_env_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("failed to resolve app data directory: {err}"))?;
    fs::create_dir_all(&app_data_dir)
        .map_err(|err| format!("failed to create app data directory: {err}"))?;
    Ok(app_data_dir.join("secrets.env"))
}

fn ensure_atlas_api_key(app: &AppHandle) -> Result<String, String> {
    let secrets_path = app_secrets_env_path(app)?;

    // Try to read existing key from secrets.env
    if secrets_path.exists() {
        if let Ok(content) = fs::read_to_string(&secrets_path) {
            for line in content.lines() {
                if let Some(value) = line.strip_prefix("ATLAS_API_KEY=") {
                    let trimmed = value.trim();
                    if !trimmed.is_empty() {
                        return Ok(trimmed.to_string());
                    }
                }
            }
        }
    }

    // Generate a new key (32 random hex bytes = 64 hex chars)
    let mut rng = rand::thread_rng();
    let key: String = (0..32)
        .map(|_| format!("{:02x}", rng.gen::<u8>()))
        .collect();

    // Write to secrets.env (append or create)
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&secrets_path)
        .map_err(|err| format!("failed to open secrets.env: {err}"))?;
    writeln!(file, "ATLAS_API_KEY={key}")
        .map_err(|err| format!("failed to write API key: {err}"))?;

    Ok(key)
}

fn resolve_python_binary(base_dir: &Path, app: Option<&AppHandle>) -> PathBuf {
    // 1. Check for bundled python
    if let Some(app) = app {
        if let Ok(dir) = bundle_resource_dir(app) {
            let bundled = dir.join("python/bin/python3");
            if bundled.exists() {
                return bundled;
            }
        }
    }

    // 2. Check for venv python at the given base directory (repo root for modules, service_dir for scripts)
    let venv_python = base_dir.join(".venv/bin/python");
    if venv_python.exists() {
        return venv_python;
    }

    // 3. Fall back to system python
    PathBuf::from("python3")
}

fn ensure_log_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("failed to resolve app data directory: {err}"))?;

    fs::create_dir_all(&app_data_dir)
        .map_err(|err| format!("failed to create app data directory: {err}"))?;

    let log_dir = app_data_dir.join("logs");
    fs::create_dir_all(&log_dir).map_err(|err| format!("failed to create log directory: {err}"))?;

    Ok(log_dir)
}

fn unix_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn should_start_hidden() -> bool {
    std::env::args().any(|arg| arg == "--headless")
}

fn restart_backoff_ms(attempt: u32) -> u64 {
    let exponent = attempt.min(6);
    let seconds = 2_u64.pow(exponent);
    seconds.min(MAX_RESTART_BACKOFF_SECONDS) * 1000
}

fn should_autostart_services_on_launch(default_setting: bool) -> bool {
    match std::env::var("CODOS_DESKTOP_AUTO_START_SERVICES") {
        Ok(value) => {
            let normalized = value.trim().to_ascii_lowercase();
            !matches!(normalized.as_str(), "0" | "false" | "no")
        }
        Err(_) => default_setting,
    }
}

fn is_vault_ready() -> bool {
    detect_default_vault_path()
        .map(|path| validate_vault_path_inner(&path).valid)
        .unwrap_or(false)
}

fn is_port_available(port: u16) -> bool {
    // Check 0.0.0.0 first (telegram-agent binds all interfaces), then 127.0.0.1.
    // On macOS, SO_REUSEADDR can let 127.0.0.1 bind succeed even when 0.0.0.0 is held.
    TcpListener::bind(("0.0.0.0", port)).is_ok() && TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// Kill any process occupying the given port. Mirrors bootstrap.sh's `kill_port`.
/// Sends SIGTERM, waits 500ms, then SIGKILL survivors. Skips our own PID.
fn kill_port_occupants(port: u16) {
    let own_pid = std::process::id() as i32;
    let output = match Command::new("lsof")
        .args(["-ti", &format!(":{port}")])
        .output()
    {
        Ok(o) => o,
        Err(_) => return,
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    let pids: Vec<i32> = stdout
        .split_whitespace()
        .filter_map(|s| s.parse::<i32>().ok())
        .filter(|&pid| pid != own_pid)
        .collect();
    if pids.is_empty() {
        return;
    }
    // SIGTERM first
    for &pid in &pids {
        unsafe { libc::kill(pid, libc::SIGTERM) };
    }
    std::thread::sleep(Duration::from_millis(500));
    // SIGKILL survivors
    for &pid in &pids {
        unsafe { libc::kill(pid, libc::SIGKILL) };
    }
    // Brief pause to let the OS release the port
    std::thread::sleep(Duration::from_millis(100));
}

fn is_port_open(port: u16) -> bool {
    let addr: SocketAddr = match format!("127.0.0.1:{port}").parse() {
        Ok(addr) => addr,
        Err(_) => return false,
    };
    TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
}

fn compute_runtime_network(settings: &RuntimeSettings) -> RuntimeNetwork {
    if settings.backend_mode == BackendMode::AttachExisting {
        let conflicts = !is_port_available(DEFAULT_BACKEND_PORT)
            || !is_port_available(DEFAULT_TELEGRAM_AGENT_PORT);
        return RuntimeNetwork {
            backend_port: DEFAULT_BACKEND_PORT,
            telegram_agent_port: DEFAULT_TELEGRAM_AGENT_PORT,
            uses_isolated_ports: false,
            port_conflict_detected: conflicts,
            attach_existing_backend: true,
        };
    }

    let default_backend_free = is_port_available(DEFAULT_BACKEND_PORT);
    let default_telegram_free = is_port_available(DEFAULT_TELEGRAM_AGENT_PORT);

    // Always use default ports - fail if not available rather than using alternate ports
    // The frontend is hardcoded to connect to default ports
    RuntimeNetwork {
        backend_port: DEFAULT_BACKEND_PORT,
        telegram_agent_port: DEFAULT_TELEGRAM_AGENT_PORT,
        uses_isolated_ports: false,
        port_conflict_detected: !default_backend_free || !default_telegram_free,
        attach_existing_backend: false,
    }
}

fn normalize_user_path(path: &str) -> PathBuf {
    let expanded = expand_tilde(path.trim());
    if expanded.exists() {
        return fs::canonicalize(&expanded).unwrap_or(expanded);
    }
    if expanded.is_absolute() {
        return expanded;
    }
    std::env::current_dir()
        .map(|cwd| cwd.join(&expanded))
        .unwrap_or(expanded)
}

fn expand_tilde(path: &str) -> PathBuf {
    if path == "~" {
        if let Some(home) = home_dir() {
            return home;
        }
    }
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(path)
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn detect_default_vault_path() -> Option<String> {
    if let Ok(path) = std::env::var("VAULT_PATH") {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return Some(normalize_user_path(trimmed).to_string_lossy().to_string());
        }
    }

    if let Some(home) = home_dir() {
        let atlas_paths = home.join(".codos/paths.json");
        if let Ok(raw) = fs::read_to_string(atlas_paths) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) {
                if let Some(path) = json.get("vaultPath").and_then(|value| value.as_str()) {
                    let trimmed = path.trim();
                    if !trimmed.is_empty() {
                        return Some(normalize_user_path(trimmed).to_string_lossy().to_string());
                    }
                }
            }
        }

        let fallback = home.join("projects").join("codos_vault");
        if fallback.exists() {
            return Some(fallback.to_string_lossy().to_string());
        }
    }

    None
}

fn validate_vault_path_inner(path: &str) -> VaultPathValidationResult {
    let raw_path = path.trim();
    if raw_path.is_empty() {
        return VaultPathValidationResult {
            path: String::new(),
            exists: false,
            is_directory: false,
            readable: false,
            writable: false,
            valid: false,
            message: "Vault path is empty".to_string(),
        };
    }

    let normalized = normalize_user_path(raw_path);
    let exists = normalized.exists();
    let is_directory = exists && normalized.is_dir();
    let readable = if is_directory {
        fs::read_dir(&normalized).is_ok()
    } else {
        false
    };

    let writable = if is_directory {
        let probe_path = normalized.join(format!(".codos-write-check-{}", unix_now_ms()));
        match OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&probe_path)
        {
            Ok(mut probe) => {
                let _ = probe.write_all(b"codos");
                let _ = fs::remove_file(&probe_path);
                true
            }
            Err(_) => false,
        }
    } else {
        false
    };

    let valid = exists && is_directory && readable && writable;
    let message = if valid {
        "Vault path is accessible".to_string()
    } else if !exists {
        "Path does not exist".to_string()
    } else if !is_directory {
        "Path is not a directory".to_string()
    } else if !readable {
        "Directory is not readable".to_string()
    } else if !writable {
        "Directory is not writable".to_string()
    } else {
        "Vault path validation failed".to_string()
    };

    VaultPathValidationResult {
        path: normalized.to_string_lossy().to_string(),
        exists,
        is_directory,
        readable,
        writable,
        valid,
        message,
    }
}

fn sync_launch_at_login_setting(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let auto_launch = app.autolaunch();
    if enabled {
        auto_launch
            .enable()
            .map_err(|err| format!("failed to enable launch at login: {err}"))?;
    } else {
        auto_launch
            .disable()
            .map_err(|err| format!("failed to disable launch at login: {err}"))?;
    }

    Ok(())
}

fn spawn_service_supervisor(app_handle: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(4));

        let manager = app_handle.state::<ServiceManager>();
        let lock_result = manager.state.lock();
        let mut state = match lock_result {
            Ok(guard) => guard,
            Err(_) => continue,
        };

        let mut service_ids: Vec<String> = state.services.keys().cloned().collect();
        service_ids.sort();

        for service_id in &service_ids {
            if let Some(runtime) = state.services.get_mut(service_id) {
                if let Some(message) = refresh_runtime_process_state(runtime) {
                    record_event(&mut state, service_id, "warn", message);
                }
            }
        }

        let now_ms = unix_now_ms();
        for service_id in &service_ids {
            let mut should_restart = false;
            let mut should_give_up = false;
            if let Some(runtime) = state.services.get(service_id) {
                let within_retry_budget = runtime
                    .config
                    .max_restart_attempts
                    .map(|max_attempts| runtime.restart_attempts <= max_attempts)
                    .unwrap_or(true);
                let timer_elapsed = runtime
                    .next_restart_at_ms
                    .map(|next_restart| now_ms >= next_restart)
                    .unwrap_or(false);

                should_restart = runtime.should_run
                    && runtime.config.restart_on_crash
                    && runtime.process.is_none()
                    && timer_elapsed
                    && within_retry_budget;

                should_give_up = runtime.should_run
                    && runtime.config.restart_on_crash
                    && runtime.process.is_none()
                    && timer_elapsed
                    && !within_retry_budget;
            }

            if should_give_up {
                let mut restart_limit: Option<u32> = None;
                if let Some(runtime) = state.services.get_mut(service_id) {
                    runtime.should_run = false;
                    runtime.next_restart_at_ms = None;
                    restart_limit = runtime.config.max_restart_attempts;
                }
                record_event(
                    &mut state,
                    service_id,
                    "error",
                    format!(
                        "service restart attempts exhausted (limit={})",
                        restart_limit.unwrap_or(0)
                    ),
                );
                continue;
            }

            if should_restart {
                record_event(&mut state, service_id, "info", "attempting crash restart");
                if let Err(error) = start_service_inner(&app_handle, &mut state, service_id) {
                    if let Some(runtime) = state.services.get_mut(service_id) {
                        runtime.last_error = Some(error);
                        runtime.next_restart_at_ms =
                            Some(unix_now_ms() + restart_backoff_ms(runtime.restart_attempts));
                        runtime.restart_attempts = runtime.restart_attempts.saturating_add(1);
                    }
                    record_event(&mut state, service_id, "error", "crash restart failed");
                } else {
                    record_event(
                        &mut state,
                        service_id,
                        "info",
                        "service restarted after crash",
                    );
                }
            }
        }
    });
}

fn install_close_to_hide_behavior(window: &WebviewWindow) {
    let event_source = window.clone();
    let hide_target = window.clone();
    event_source.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = hide_target.hide();
        }
    });
}

fn show_main_window_internal(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    window
        .show()
        .map_err(|err| format!("failed to show main window: {err}"))?;
    window
        .set_focus()
        .map_err(|err| format!("failed to focus main window: {err}"))?;

    Ok(())
}

fn setup_system_tray(app: &AppHandle) -> Result<(), String> {
    let open_item = MenuItem::with_id(app, "open", "Open Codos", true, None::<&str>)
        .map_err(|err| format!("failed to create tray open item: {err}"))?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)
        .map_err(|err| format!("failed to create tray quit item: {err}"))?;
    let tray_menu = Menu::with_items(app, &[&open_item, &quit_item])
        .map_err(|err| format!("failed to create tray menu: {err}"))?;

    TrayIconBuilder::with_id("codos-tray")
        .menu(&tray_menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => {
                if let Err(error) = show_main_window_internal(app) {
                    eprintln!("failed to show main window from tray: {error}");
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Err(error) = show_main_window_internal(&tray.app_handle().clone()) {
                    eprintln!("failed to show main window from tray click: {error}");
                }
            }
        })
        .build(app)
        .map_err(|err| format!("failed to build tray icon: {err}"))?;

    Ok(())
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--headless"]),
        ))
        .manage(ServiceManager::default())
        .setup(|app| {
            let app_handle = app.handle().clone();
            setup_system_tray(&app_handle)?;

            // Ensure API key exists on startup
            if let Err(error) = ensure_atlas_api_key(&app_handle) {
                eprintln!("failed to ensure API key: {error}");
            }

            let loaded_settings = RuntimeSettings::default();
            if let Err(error) =
                sync_launch_at_login_setting(&app_handle, loaded_settings.launch_at_login_enabled)
            {
                eprintln!("{error}");
            }

            // Clean up old runtime-settings.json if it exists
            if let Ok(app_data_dir) = app_handle.path().app_data_dir() {
                let old_settings = app_data_dir.join("runtime-settings.json");
                let _ = fs::remove_file(old_settings);
            }

            if let Some(window) = app.get_webview_window("main") {
                install_close_to_hide_behavior(&window);

                if should_start_hidden() {
                    let _ = window.hide();
                }
            }

            let manager = app.state::<ServiceManager>();
            let lock_result = manager.state.lock();
            if let Ok(mut state) = lock_result {
                state.runtime_settings = loaded_settings.clone();
                state.runtime_network = compute_runtime_network(&loaded_settings);

                let should_autostart = should_autostart_services_on_launch(
                    loaded_settings.auto_start_services_on_launch,
                );
                let vault_ready = is_vault_ready();

                // Always start core services (backend + telegram-agent) —
                // they're needed for the setup wizard and don't require vault.
                const ALWAYS_START: [&str; 2] =
                    [CONNECTOR_BACKEND_SERVICE_ID, TELEGRAM_AGENT_SERVICE_ID];
                if should_autostart {
                    for &svc in &ALWAYS_START {
                        if let Err(error) = start_service_inner(&app_handle, &mut state, svc) {
                            if let Some(runtime) = state.services.get_mut(svc) {
                                runtime.last_error = Some(error);
                            }
                            record_event(
                                &mut state,
                                svc,
                                "error",
                                "initial autostart failed during app setup",
                            );
                        }
                    }
                }

                if should_autostart && vault_ready {
                    let mut autostart_ids: Vec<String> = state
                        .services
                        .values()
                        .filter(|runtime| {
                            runtime.config.autostart && !ALWAYS_START.contains(&runtime.config.id)
                        })
                        .map(|runtime| runtime.config.id.to_string())
                        .collect();
                    autostart_ids.sort();

                    for service_id in autostart_ids {
                        if let Err(error) =
                            start_service_inner(&app_handle, &mut state, &service_id)
                        {
                            if let Some(runtime) = state.services.get_mut(&service_id) {
                                runtime.last_error = Some(error);
                            }
                            record_event(
                                &mut state,
                                &service_id,
                                "error",
                                "initial autostart failed during app setup",
                            );
                        }
                    }
                } else if should_autostart && !vault_ready {
                    record_event(
                        &mut state,
                        CONNECTOR_BACKEND_SERVICE_ID,
                        "warn",
                        "vault path is missing or invalid — only core services started",
                    );
                }
            }

            spawn_service_supervisor(app_handle);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_services,
            get_service_events,
            get_service_registry,
            get_service_catalog,
            update_service_registry,
            get_default_vault_path,
            validate_vault_path,
            get_runtime_bootstrap_status,
            start_service,
            stop_service,
            start_autostart_services,
            start_backend,
            stop_backend,
            backend_status,
            show_main_window,
            get_runtime_settings,
            update_runtime_settings,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build codos desktop application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            let manager = app_handle.state::<ServiceManager>();
            let lock_result = manager.state.lock();
            // Use lock or force-acquire on poisoned mutex — we must kill
            // children on exit regardless of whether a thread panicked.
            let mut state = match lock_result {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            for (_, runtime) in state.services.iter_mut() {
                if let Some(mut process) = runtime.process.take() {
                    kill_process_tree(&mut process);
                }
                runtime.should_run = false;
            }
        }
    });
}
