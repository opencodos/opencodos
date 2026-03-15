/** Shared path configuration. Loads from ~/.codos/paths.json. */

import { readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

interface CodosPaths {
  codosPath: string;
  vaultPath: string;
  userName: string;
}

let cachedPaths: CodosPaths | null = null;

export function loadPaths(): CodosPaths {
  if (cachedPaths) return cachedPaths;

  const configPath = join(homedir(), ".codos", "paths.json");

  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, "utf-8");
      const config = JSON.parse(content);
      cachedPaths = {
        codosPath: config.codos_path,
        vaultPath: config.vault_path,
        userName: config.user_name || "the user",
      };
      return cachedPaths;
    } catch (error) {
      console.error("Failed to load ~/.codos/paths.json:", error);
    }
  }

  const codosPath = process.env.CODOS_PATH || join(homedir(), "codos");
  const vaultPath = process.env.VAULT_PATH || join(homedir(), "codos_vault");

  cachedPaths = { codosPath, vaultPath, userName: process.env.USER_NAME || "the user" };
  return cachedPaths;
}

export function getUserName(): string {
  return loadPaths().userName;
}

export function getVaultRoot(): string {
  const { vaultPath } = loadPaths();
  return vaultPath;
}

export function getInboxDir(connector: string): string {
  const vaultRoot = getVaultRoot();
  return join(vaultRoot, "1 - Inbox (Last 7 days)", connector);
}

export function getLogDir(subsystem: string): string {
  const logRoot = join(homedir(), ".codos", "logs", subsystem);
  if (!existsSync(logRoot)) {
    mkdirSync(logRoot, { recursive: true });
  }
  return logRoot;
}
