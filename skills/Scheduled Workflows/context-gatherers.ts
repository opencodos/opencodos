import { existsSync, readFileSync, statSync } from "fs";
import { join, resolve, dirname } from "path";
import { homedir } from "os";
import { loadPaths } from "../../ingestion/lib/paths";

export type ContextSource =
  | {
      type: "file";
      path: string;
      title?: string;
      max_chars?: number;
      optional?: boolean;
    }
  | {
      type: "glob";
      pattern: string;
      title?: string;
      max_files?: number;
      max_chars_per_file?: number;
      optional?: boolean;
      sort?: "mtime_desc" | "mtime_asc" | "name";
    }
  | {
      type: "text";
      title?: string;
      text: string;
    };

export interface ContextChunk {
  title: string;
  content: string;
  source?: string;
}

const DEFAULT_MAX_CHARS_PER_FILE = 12000;
const DEFAULT_MAX_FILES = 20;

function truncate(text: string, maxChars?: number): string {
  if (!maxChars || text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[TRUNCATED ${text.length - maxChars} CHARS]`;
}

export function resolveWorkflowPath(
  inputPath: string,
  workflowDir: string,
): string {
  const { codosPath, vaultPath } = loadPaths();

  if (inputPath.startsWith("Vault/")) {
    return join(vaultPath, inputPath.replace(/^Vault\//, ""));
  }

  if (inputPath.startsWith("Codos/")) {
    return join(codosPath, inputPath.replace(/^Codos\//, ""));
  }

  if (inputPath.startsWith("~/")) {
    return join(homedir(), inputPath.slice(2));
  }

  if (inputPath.startsWith("./") || inputPath.startsWith("../")) {
    return resolve(join(workflowDir, inputPath));
  }

  return inputPath;
}

function readFileChunk(path: string, maxChars?: number): string {
  const content = readFileSync(path, "utf-8");
  return truncate(content, maxChars);
}

function sortByMtime(files: string[], dir: string, order: "asc" | "desc"): string[] {
  return files
    .map((name) => {
      const full = join(dir, name);
      const mtime = existsSync(full) ? statSync(full).mtimeMs : 0;
      return { name, mtime };
    })
    .sort((a, b) => (order === "asc" ? a.mtime - b.mtime : b.mtime - a.mtime))
    .map((entry) => entry.name);
}

function splitGlobPattern(fullPattern: string): { baseDir: string; pattern: string } {
  const globChars = new Set(["*", "?", "["]);
  let firstGlobIndex = -1;
  for (let i = 0; i < fullPattern.length; i += 1) {
    if (globChars.has(fullPattern[i])) {
      firstGlobIndex = i;
      break;
    }
  }

  if (firstGlobIndex === -1) {
    const baseDir = dirname(fullPattern);
    const pattern = fullPattern.slice(baseDir.length + 1);
    return { baseDir, pattern };
  }

  const prefix = fullPattern.slice(0, firstGlobIndex);
  const lastSlash = prefix.lastIndexOf("/");
  if (lastSlash === -1) {
    return { baseDir: ".", pattern: fullPattern };
  }

  return {
    baseDir: fullPattern.slice(0, lastSlash),
    pattern: fullPattern.slice(lastSlash + 1),
  };
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

function interpolateDateTokens(template: string): string {
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

export async function gatherContext(
  sources: ContextSource[] | undefined,
  workflowDir: string,
): Promise<ContextChunk[]> {
  if (!sources || sources.length === 0) return [];

  const chunks: ContextChunk[] = [];

  for (const source of sources) {
    if (source.type === "text") {
      chunks.push({
        title: source.title || "Inline Context",
        content: source.text,
        source: "inline",
      });
      continue;
    }

    if (source.type === "file") {
      const resolved = resolveWorkflowPath(interpolateDateTokens(source.path), workflowDir);
      if (!existsSync(resolved)) {
        if (!source.optional) {
          chunks.push({
            title: source.title || "Missing File",
            content: `File not found: ${resolved}`,
            source: resolved,
          });
        }
        continue;
      }

      const content = readFileChunk(resolved, source.max_chars);
      chunks.push({
        title: source.title || resolved,
        content,
        source: resolved,
      });
      continue;
    }

    if (source.type === "glob") {
      const resolvedPattern = resolveWorkflowPath(interpolateDateTokens(source.pattern), workflowDir);
      const { baseDir, pattern } = splitGlobPattern(resolvedPattern);

      const glob = new Bun.Glob(pattern);
      const files = Array.from(glob.scanSync({ cwd: baseDir })) as string[];

      if (files.length === 0) {
        if (!source.optional) {
          chunks.push({
            title: source.title || "No Matching Files",
            content: `No files matched: ${resolvedPattern}`,
            source: resolvedPattern,
          });
        }
        continue;
      }

      let ordered = files;
      if (source.sort === "mtime_asc") {
        ordered = sortByMtime(files, baseDir, "asc");
      } else if (source.sort === "mtime_desc" || !source.sort) {
        ordered = sortByMtime(files, baseDir, "desc");
      } else if (source.sort === "name") {
        ordered = [...files].sort();
      }

      const maxFiles = source.max_files ?? DEFAULT_MAX_FILES;
      const maxChars = source.max_chars_per_file ?? DEFAULT_MAX_CHARS_PER_FILE;
      const selected = ordered.slice(0, maxFiles);

      for (const relative of selected) {
        const full = join(baseDir, relative);
        if (!existsSync(full)) continue;
        const content = readFileChunk(full, maxChars);
        chunks.push({
          title: source.title ? `${source.title}: ${relative}` : relative,
          content,
          source: full,
        });
      }
    }
  }

  return chunks;
}
