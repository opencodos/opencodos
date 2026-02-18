import { existsSync, mkdirSync, appendFileSync, createWriteStream, readFileSync } from "fs";
import { join, basename, dirname } from "path";
import { spawn } from "child_process";
import YAML from "yaml";
import { loadPaths } from "../../ingestion/lib/paths";
import { gatherContext, resolveWorkflowPath, type ContextSource, type ContextChunk } from "./context-gatherers";

interface WorkflowSchedule {
  type: "daily" | "weekly" | "cron" | "interval" | "manual";
  time?: string;
  day?: string;
  cron?: string;
  interval_minutes?: number;
}

interface WorkflowOutput {
  path?: string;
  overwrite?: boolean;
}

interface WorkflowRunner {
  model?: string;
  timeout_sec?: number;
  unset_api_key?: boolean;
  allowed_tools?: string;
  permission_mode?: string;
  chrome?: boolean;
}

interface WorkflowConfig {
  name: string;
  description?: string;
  schedule?: WorkflowSchedule;
  context?: ContextSource[];
  prompt: string;
  output?: WorkflowOutput;
  runner?: WorkflowRunner;
}

interface RunResult {
  status: "success" | "skipped" | "error";
  outputPath?: string;
  error?: string;
}

const WORKFLOW_ROOT = "skills/Scheduled Workflows/workflows";
const LOG_ROOT = "dev/Logs/workflows";

function usage(): void {
  console.log("Usage:");
  console.log("  bun run run-workflow.ts --id <workflow-id>");
  console.log("  bun run run-workflow.ts --config <path>");
  console.log("  bun run run-workflow.ts --list");
  console.log("  bun run run-workflow.ts --id <workflow-id> --dry-run");
  console.log("  bun run run-workflow.ts --id <workflow-id> --print-prompt");
}

function parseArgs(argv: string[]): {
  id?: string;
  configPath?: string;
  list?: boolean;
  dryRun?: boolean;
  printPrompt?: boolean;
} {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--id") {
      args.id = argv[i + 1];
      i += 1;
    } else if (arg === "--config") {
      args.configPath = argv[i + 1];
      i += 1;
    } else if (arg === "--list") {
      args.list = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--print-prompt") {
      args.printPrompt = true;
    }
  }
  return args;
}

function getWorkflowConfigPathById(id: string, codosPath: string): string | null {
  const base = join(codosPath, WORKFLOW_ROOT, `${id}.yaml`);
  if (existsSync(base)) return base;
  const alt = join(codosPath, WORKFLOW_ROOT, `${id}.yml`);
  if (existsSync(alt)) return alt;
  return null;
}

function listWorkflows(codosPath: string): void {
  const root = join(codosPath, WORKFLOW_ROOT);
  const yamlGlob = new Bun.Glob("*.yaml");
  const ymlGlob = new Bun.Glob("*.yml");
  const workflows = [
    ...Array.from(yamlGlob.scanSync({ cwd: root })),
    ...Array.from(ymlGlob.scanSync({ cwd: root })),
  ] as string[];
  const filtered = workflows.filter((name) => !name.startsWith("_"));
  if (filtered.length === 0) {
    console.log("No workflows found.");
    return;
  }
  console.log("Workflows:");
  for (const file of filtered) {
    console.log(`- ${file.replace(/\.ya?ml$/, "")}`);
  }
}

function loadWorkflowConfig(configPath: string): WorkflowConfig {
  const raw = readFileSync(configPath, "utf-8");
  const parsed = YAML.parse(raw) as WorkflowConfig;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid workflow config.");
  }
  if (!parsed.name || !parsed.prompt) {
    throw new Error("Workflow config requires name and prompt.");
  }
  return parsed;
}

function formatIsoWeek(date: Date): string {
  const target = new Date(date.valueOf());
  target.setHours(0, 0, 0, 0);

  const day = (target.getDay() + 6) % 7;
  const thursday = new Date(target);
  thursday.setDate(target.getDate() - day + 3);

  const isoYear = thursday.getFullYear();
  const jan4 = new Date(isoYear, 0, 4);
  const jan4Day = (jan4.getDay() + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - jan4Day);
  week1Monday.setHours(0, 0, 0, 0);

  const week = Math.floor((target.getTime() - week1Monday.getTime()) / 604800000) + 1;
  return String(week).padStart(2, "0");
}

function interpolatePath(template: string): string {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  const date = `${year}-${month}-${day}`;
  const datetime = `${date}-${hour}${minute}`;
  const week = formatIsoWeek(now);

  return template
    .replaceAll("{DATETIME}", datetime)
    .replaceAll("{DATE}", date)
    .replaceAll("{YEAR}", year)
    .replaceAll("{MONTH}", month)
    .replaceAll("{DAY}", day)
    .replaceAll("{HOUR}", hour)
    .replaceAll("{MINUTE}", minute)
    .replaceAll("{WEEK}", week);
}

function buildContextText(chunks: ContextChunk[]): string {
  return chunks
    .map((chunk) => {
      const header = `### ${chunk.title}`;
      const source = chunk.source ? `Source: ${chunk.source}` : "";
      return [header, source, chunk.content].filter(Boolean).join("\n\n");
    })
    .join("\n\n---\n\n");
}

async function runClaude(prompt: string, runner: WorkflowRunner): Promise<string> {
  // Write prompt to temp file (stdin piping doesn't work in subprocess)
  const tempFile = `/tmp/workflow-prompt-${Date.now()}.txt`;
  const { writeFileSync, unlinkSync } = await import("fs");
  writeFileSync(tempFile, prompt, "utf-8");

  // Use shell to cat the file and pipe to claude
  const cmdParts = [`cat "${tempFile}" | claude -p`];
  if (runner.chrome) {
    cmdParts.push("--chrome");
  }
  if (runner.model) {
    cmdParts.push(`--model ${runner.model}`);
  }
  if (runner.allowed_tools) {
    // Use --tools to set available tools (not --allowedTools which only adds to allowed list)
    cmdParts.push(`--tools "${runner.allowed_tools}"`);
  }
  if (runner.permission_mode === "bypassPermissions") {
    // --dangerously-skip-permissions is required to actually bypass permissions
    cmdParts.push(`--dangerously-skip-permissions`);
  } else if (runner.permission_mode) {
    cmdParts.push(`--permission-mode ${runner.permission_mode}`);
  }
  const cmd = cmdParts.join(" ");

  const env = { ...process.env } as Record<string, string>;
  if (runner.unset_api_key !== false) {
    delete env.ANTHROPIC_API_KEY;
  }

  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-c", cmd], { env });
    let output = "";
    let error = "";

    const timeoutSec = runner.timeout_sec ?? 1200;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Claude timed out after ${timeoutSec}s`));
    }, timeoutSec * 1000);

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      error += chunk.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      // Cleanup temp file
      try { unlinkSync(tempFile); } catch {}
      if (code === 0) {
        resolve(output.trim());
      } else {
        reject(new Error(error || `Claude exited with code ${code}`));
      }
    });
  });
}

function appendRunLog(codosPath: string, workflowId: string, payload: Record<string, unknown>): void {
  const logDir = join(codosPath, LOG_ROOT, workflowId);
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, "runs.jsonl");
  appendFileSync(logPath, `${JSON.stringify(payload)}\n`);
}

async function runWorkflow(configPath: string, options: { dryRun?: boolean; printPrompt?: boolean }): Promise<RunResult> {
  const { codosPath } = loadPaths();
  const configDir = dirname(configPath);
  const workflowId = basename(configPath).replace(/\.ya?ml$/, "");
  const config = loadWorkflowConfig(configPath);

  const outputTemplate = config.output?.path;
  const outputPath = outputTemplate
    ? resolveWorkflowPath(interpolatePath(outputTemplate), configDir)
    : undefined;

  if (outputPath && existsSync(outputPath) && !config.output?.overwrite) {
    const result: RunResult = { status: "skipped", outputPath };
    appendRunLog(codosPath, workflowId, {
      id: workflowId,
      name: config.name,
      status: result.status,
      output_path: outputPath,
      timestamp: new Date().toISOString(),
      message: "Output already exists",
    });
    return result;
  }

  const chunks = await gatherContext(config.context, configDir);
  const contextText = chunks.length > 0 ? buildContextText(chunks) : "";
  const fullPrompt = contextText
    ? `${config.prompt}\n\n## Context\n\n${contextText}`
    : config.prompt;

  if (options.printPrompt) {
    console.log(fullPrompt);
  }

  if (options.dryRun) {
    const result: RunResult = { status: "skipped", outputPath };
    appendRunLog(codosPath, workflowId, {
      id: workflowId,
      name: config.name,
      status: result.status,
      output_path: outputPath,
      timestamp: new Date().toISOString(),
      message: "Dry run only",
    });
    return result;
  }

  const runner: WorkflowRunner = {
    model: config.runner?.model || "opus",
    timeout_sec: config.runner?.timeout_sec ?? 1200,
    unset_api_key: config.runner?.unset_api_key ?? true,
    allowed_tools: config.runner?.allowed_tools ?? (config.runner?.chrome ? undefined : "Read,Edit,Write,Bash,WebSearch,WebFetch"),
    permission_mode: config.runner?.permission_mode ?? "bypassPermissions",
    chrome: config.runner?.chrome ?? false,
  };

  const startedAt = Date.now();
  try {
    const output = await runClaude(fullPrompt, runner);

    if (outputPath) {
      const dir = dirname(outputPath);
      mkdirSync(dir, { recursive: true });
      const stream = createWriteStream(outputPath, { encoding: "utf-8" });
      stream.write(output + "\n");
      stream.end();
    } else {
      console.log(output);
    }

    const durationMs = Date.now() - startedAt;
    appendRunLog(codosPath, workflowId, {
      id: workflowId,
      name: config.name,
      status: "success",
      output_path: outputPath,
      timestamp: new Date().toISOString(),
      duration_ms: durationMs,
    });

    return { status: "success", outputPath };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    appendRunLog(codosPath, workflowId, {
      id: workflowId,
      name: config.name,
      status: "error",
      output_path: outputPath,
      timestamp: new Date().toISOString(),
      duration_ms: durationMs,
      error: message,
    });
    return { status: "error", outputPath, error: message };
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { codosPath } = loadPaths();

  if (args.list) {
    listWorkflows(codosPath);
    return;
  }

  if (!args.id && !args.configPath) {
    usage();
    process.exit(1);
  }

  const configPath = args.configPath
    ? resolveWorkflowPath(args.configPath, process.cwd())
    : args.id
      ? getWorkflowConfigPathById(args.id, codosPath)
      : null;

  if (!configPath) {
    console.error("Workflow config not found.");
    process.exit(1);
  }

  const result = await runWorkflow(configPath, {
    dryRun: args.dryRun,
    printPrompt: args.printPrompt,
  });

  if (result.status === "error") {
    console.error(result.error || "Workflow failed");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
