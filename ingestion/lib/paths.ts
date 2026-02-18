/**
 * Shared path configuration for sync scripts.
 * Loads paths from ~/.codos/paths.json (set during wizard setup).
 */

import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

interface AtlasPaths {
  codosPath: string;
  vaultPath: string;
  userName: string;
}

export const VAULT_PATH = join(homedir(), "projects", "codos_vault");

let cachedPaths: AtlasPaths | null = null;

/**
 * Load paths from ~/.codos/paths.json
 * Falls back to environment variables or reasonable defaults.
 */
export function loadPaths(): AtlasPaths {
  if (cachedPaths) return cachedPaths;

  const atlasConfigPath = join(homedir(), ".codos", "paths.json");

  // Try to load from ~/.codos/paths.json
  if (existsSync(atlasConfigPath)) {
    try {
      const content = readFileSync(atlasConfigPath, "utf-8");
      const config = JSON.parse(content);
      cachedPaths = {
        codosPath: config.codosPath || join(homedir(), "codos"),
        vaultPath: config.vaultPath || VAULT_PATH,
        userName: config.userName || "the user",
      };
      return cachedPaths;
    } catch (error) {
      console.error("Failed to load ~/.codos/paths.json:", error);
    }
  }

  // Fallback to environment variables
  const codosPath = process.env.CODOS_PATH || join(homedir(), "codos");
  const vaultPath = process.env.VAULT_PATH || VAULT_PATH;

  cachedPaths = { codosPath, vaultPath, userName: process.env.USER_NAME || "the user" };
  return cachedPaths;
}

/**
 * Get the configured user display name
 */
export function getUserName(): string {
  return loadPaths().userName;
}

/**
 * Get the path to run-mcp.sh
 */
export function getRunMcpPath(): string {
  const { codosPath } = loadPaths();
  return join(codosPath, "dev", "Ops", "mcp", "run-mcp.sh");
}

/**
 * Get the vault root path (the "Vault" folder inside the Obsidian vault)
 */
export function getVaultRoot(): string {
  const { vaultPath } = loadPaths();
  // vaultPath points to the Vault folder directly
  return vaultPath;
}

/**
 * Get the inbox directory for a specific connector
 */
export function getInboxDir(connector: string): string {
  const vaultRoot = getVaultRoot();
  return join(vaultRoot, "1 - Inbox (Last 7 days)", connector);
}

/**
 * Get a dynamic PATH that includes common binary locations
 */
export function getDynamicPath(): string {
  const home = homedir();
  const paths = [
    join(home, ".bun", "bin"),
    join(home, ".nvm", "versions", "node", (() => {
      const nvmDir = join(home, ".nvm", "versions", "node");
      if (!existsSync(nvmDir)) return "v22.20.0";
      const versions = readdirSync(nvmDir).filter(d => d.startsWith("v")).sort();
      return versions.length > 0 ? versions[versions.length - 1] : "v22.20.0";
    })(), "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    process.env.PATH || "",
  ];
  return paths.filter(Boolean).join(":");
}

/**
 * Load environment variables from dev/Ops/.env
 * This is the single source of truth for API keys and config.
 */
export function loadEnv(): Record<string, string> {
  const { codosPath } = loadPaths();
  const envPath = join(codosPath, "dev", "Ops", ".env");
  const vars: Record<string, string> = {};

  if (existsSync(envPath)) {
    try {
      const content = readFileSync(envPath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
          const [key, ...rest] = trimmed.split("=");
          vars[key] = rest.join("=");
        }
      }
    } catch (error) {
      console.error(`Failed to load ${envPath}:`, error);
    }
  }

  return vars;
}
