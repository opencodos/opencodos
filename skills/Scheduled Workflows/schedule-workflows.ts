import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import YAML from "yaml";
import { loadPaths } from "../../ingestion/lib/paths";

interface WorkflowSchedule {
  type: "daily" | "weekly" | "cron" | "interval" | "manual";
  time?: string;
  day?: string;
  cron?: string;
  interval_minutes?: number;
}

interface WorkflowConfig {
  name: string;
  schedule?: WorkflowSchedule;
}

const WORKFLOW_ROOT = "skills/Scheduled Workflows/workflows";
const LAUNCH_AGENTS_DIR = join(homedir(), "Library", "LaunchAgents");
const WORKFLOW_LABEL_PREFIX = "com.codos.workflow";

function usage(): void {
  console.log("Usage:");
  console.log("  bun run schedule-workflows.ts list");
  console.log("  bun run schedule-workflows.ts enable <workflow-id>");
  console.log("  bun run schedule-workflows.ts disable <workflow-id>");
  console.log("  bun run schedule-workflows.ts show <workflow-id>");
  console.log("  bun run schedule-workflows.ts enable-all");
}

function getWorkflowConfigPathById(id: string, codosPath: string): string | null {
  const base = join(codosPath, WORKFLOW_ROOT, `${id}.yaml`);
  if (existsSync(base)) return base;
  const alt = join(codosPath, WORKFLOW_ROOT, `${id}.yml`);
  if (existsSync(alt)) return alt;
  return null;
}

function listWorkflowIds(codosPath: string): string[] {
  const root = join(codosPath, WORKFLOW_ROOT);
  const yamlGlob = new Bun.Glob("*.yaml");
  const ymlGlob = new Bun.Glob("*.yml");
  const workflows = [
    ...Array.from(yamlGlob.scanSync({ cwd: root })),
    ...Array.from(ymlGlob.scanSync({ cwd: root })),
  ] as string[];
  return workflows
    .filter((name) => !name.startsWith("_"))
    .map((name) => name.replace(/\.ya?ml$/, ""))
    .sort();
}

function loadWorkflowConfig(configPath: string): WorkflowConfig {
  const raw = readFileSync(configPath, "utf-8");
  return YAML.parse(raw) as WorkflowConfig;
}

function parseTime(value: string | undefined): { hour: number; minute: number } {
  if (!value) throw new Error("schedule.time is required for daily/weekly schedules");
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) throw new Error(`Invalid time format: ${value}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid time: ${value}`);
  }
  return { hour, minute };
}

function dayToLaunchd(day: string | undefined): number {
  if (!day) throw new Error("schedule.day is required for weekly schedules");
  const normalized = day.toLowerCase();
  const map: Record<string, number> = {
    sunday: 0,
    sun: 0,
    monday: 1,
    mon: 1,
    tuesday: 2,
    tue: 2,
    wednesday: 3,
    wed: 3,
    thursday: 4,
    thu: 4,
    friday: 5,
    fri: 5,
    saturday: 6,
    sat: 6,
  };
  if (!(normalized in map)) throw new Error(`Invalid weekday: ${day}`);
  return map[normalized];
}

function normalizeCronWeekday(value: string): string {
  const normalized = value.trim().toLowerCase();
  const map: Record<string, string> = {
    sunday: "0",
    sun: "0",
    monday: "1",
    mon: "1",
    tuesday: "2",
    tue: "2",
    wednesday: "3",
    wed: "3",
    thursday: "4",
    thu: "4",
    friday: "5",
    fri: "5",
    saturday: "6",
    sat: "6",
  };

  if (normalized in map) return map[normalized];

  const num = Number(normalized);
  if (!Number.isNaN(num)) {
    if (num === 7) return "0";
    if (num >= 0 && num <= 6) return String(num);
  }

  throw new Error(`Invalid cron weekday: ${value}`);
}

function parseCron(cron: string): { minutes: string[]; hours: string[]; weekdays: string[] } {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Cron must have 5 fields: ${cron}`);
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  const disallowed = [minute, hour, dayOfMonth, month, dayOfWeek].some((field) => /[\/\-]/.test(field));
  if (disallowed) {
    throw new Error("Cron ranges or steps are not supported yet.");
  }

  if (dayOfMonth !== "*" || month !== "*") {
    throw new Error("Cron day-of-month and month fields must be '*'.");
  }

  if (minute === "*" || hour === "*") {
    throw new Error("Cron minute and hour must be explicit values.");
  }

  const minutes = minute.split(",");
  const hours = hour.split(",");
  const weekdays =
    dayOfWeek === "*"
      ? []
      : dayOfWeek.split(",").map((value) => normalizeCronWeekday(value));

  return { minutes, hours, weekdays };
}

function scheduleToPlist(schedule: WorkflowSchedule): string {
  if (schedule.type === "manual") {
    return "";
  }

  if (schedule.type === "interval") {
    if (!schedule.interval_minutes) {
      throw new Error("schedule.interval_minutes is required for interval schedules");
    }
    const interval = schedule.interval_minutes * 60;
    return `    <key>StartInterval</key>\n    <integer>${interval}</integer>`;
  }

  if (schedule.type === "daily") {
    const { hour, minute } = parseTime(schedule.time);
    return `    <key>StartCalendarInterval</key>\n    <dict>\n        <key>Hour</key>\n        <integer>${hour}</integer>\n        <key>Minute</key>\n        <integer>${minute}</integer>\n    </dict>`;
  }

  if (schedule.type === "weekly") {
    const { hour, minute } = parseTime(schedule.time);
    const weekday = dayToLaunchd(schedule.day);
    return `    <key>StartCalendarInterval</key>\n    <dict>\n        <key>Weekday</key>\n        <integer>${weekday}</integer>\n        <key>Hour</key>\n        <integer>${hour}</integer>\n        <key>Minute</key>\n        <integer>${minute}</integer>\n    </dict>`;
  }

  if (schedule.type === "cron") {
    if (!schedule.cron) throw new Error("schedule.cron is required for cron schedules");
    const parsed = parseCron(schedule.cron);
    const minutes = parsed.minutes;
    const hours = parsed.hours;
    const weekdays = parsed.weekdays.length > 0 ? parsed.weekdays : ["*"];

    const entries: string[] = [];
    for (const hour of hours) {
      for (const minute of minutes) {
        if (weekdays[0] === "*") {
          entries.push(`        <dict>\n            <key>Hour</key>\n            <integer>${hour}</integer>\n            <key>Minute</key>\n            <integer>${minute}</integer>\n        </dict>`);
        } else {
          for (const weekday of weekdays) {
            entries.push(`        <dict>\n            <key>Weekday</key>\n            <integer>${weekday}</integer>\n            <key>Hour</key>\n            <integer>${hour}</integer>\n            <key>Minute</key>\n            <integer>${minute}</integer>\n        </dict>`);
          }
        }
      }
    }

    return `    <key>StartCalendarInterval</key>\n    <array>\n${entries.join("\n")}\n    </array>`;
  }

  throw new Error(`Unsupported schedule type: ${schedule.type}`);
}

function buildPlist(workflowId: string, schedule: WorkflowSchedule, codosPath: string): string {
  const label = `${WORKFLOW_LABEL_PREFIX}.${workflowId}`;
  const workflowDir = join(codosPath, "skills", "Scheduled Workflows");
  const scriptPath = join(workflowDir, "run-workflow-cc.sh");
  const logDir = join(codosPath, "dev", "Logs", "workflows", workflowId);
  mkdirSync(logDir, { recursive: true });

  const scheduleSection = scheduleToPlist(schedule);
  if (!scheduleSection) {
    throw new Error(`Workflow ${workflowId} is manual-only and cannot be enabled.`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${scriptPath}</string>
        <string>--id</string>
        <string>${workflowId}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${workflowDir}</string>
${scheduleSection}
    <key>StandardOutPath</key>
    <string>${logDir}/stdout.log</string>
    <key>StandardErrorPath</key>
    <string>${logDir}/stderr.log</string>
    <key>RunAtLoad</key>
    <false/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${join(homedir(), ".bun", "bin")}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
`;
}

function getPlistPath(workflowId: string): string {
  return join(LAUNCH_AGENTS_DIR, `${WORKFLOW_LABEL_PREFIX}.${workflowId}.plist`);
}

function showWorkflow(workflowId: string, codosPath: string): void {
  const configPath = getWorkflowConfigPathById(workflowId, codosPath);
  if (!configPath) {
    console.error("Workflow config not found.");
    process.exit(1);
  }
  const config = loadWorkflowConfig(configPath);
  console.log(JSON.stringify(config, null, 2));
}

function listWorkflows(codosPath: string): void {
  const ids = listWorkflowIds(codosPath);
  if (ids.length === 0) {
    console.log("No workflows found.");
    return;
  }

  for (const id of ids) {
    const configPath = getWorkflowConfigPathById(id, codosPath);
    if (!configPath) continue;
    const config = loadWorkflowConfig(configPath);
    const plistPath = getPlistPath(id);
    const enabled = existsSync(plistPath) ? "enabled" : "disabled";
    const schedule = config.schedule?.type || "manual";
    console.log(`${id}  [${enabled}]  (${schedule})  ${config.name}`);
  }
}

function enableWorkflow(id: string, codosPath: string): void {
  const configPath = getWorkflowConfigPathById(id, codosPath);
  if (!configPath) {
    throw new Error(`Workflow config not found for ${id}.`);
  }

  const config = loadWorkflowConfig(configPath);
  const schedule = config.schedule;
  if (!schedule) {
    throw new Error(`Workflow ${id} has no schedule.`);
  }

  const plistContent = buildPlist(id, schedule, codosPath);
  mkdirSync(LAUNCH_AGENTS_DIR, { recursive: true });

  const plistPath = getPlistPath(id);
  writeFileSync(plistPath, plistContent, "utf-8");

  try {
    execSync(`launchctl unload "${plistPath}"`, { stdio: "ignore" });
  } catch {
    // ignore
  }

  execSync(`launchctl load "${plistPath}"`, { stdio: "inherit" });
  console.log(`Enabled ${id}`);
}

function disableWorkflow(id: string): void {
  const plistPath = getPlistPath(id);
  if (!existsSync(plistPath)) {
    console.log(`Workflow ${id} is not enabled.`);
    return;
  }

  try {
    execSync(`launchctl unload "${plistPath}"`, { stdio: "inherit" });
  } catch {
    // ignore
  }

  unlinkSync(plistPath);
  console.log(`Disabled ${id}`);
}

function enableAllWorkflows(codosPath: string): void {
  const ids = listWorkflowIds(codosPath);
  let enabled = 0;
  let skipped = 0;
  let failed = 0;

  for (const id of ids) {
    const configPath = getWorkflowConfigPathById(id, codosPath);
    if (!configPath) {
      console.error(`Config not found for ${id}, skipping`);
      skipped++;
      continue;
    }

    const config = loadWorkflowConfig(configPath);
    if (!config.schedule || config.schedule.type === "manual") {
      skipped++;
      continue;
    }

    try {
      enableWorkflow(id, codosPath);
      enabled++;
    } catch (error) {
      console.error(`Failed to enable ${id}: ${error}`);
      failed++;
    }
  }

  console.log(`Done: ${enabled} enabled, ${skipped} skipped, ${failed} failed`);
}

function main(): void {
  const args = process.argv.slice(2);
  const { codosPath } = loadPaths();

  if (args.length === 0) {
    usage();
    process.exit(1);
  }

  const command = args[0];
  const id = args[1];

  if (command === "list") {
    listWorkflows(codosPath);
    return;
  }

  if (command === "enable-all") {
    enableAllWorkflows(codosPath);
    return;
  }

  if (command === "show" && id) {
    showWorkflow(id, codosPath);
    return;
  }

  if (command === "enable" && id) {
    try {
      enableWorkflow(id, codosPath);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    return;
  }

  if (command === "disable" && id) {
    disableWorkflow(id);
    return;
  }

  usage();
  process.exit(1);
}

main();
