/**
 * Filesystem utilities for sync scripts.
 * Provides atomic writes and directory helpers.
 */

import { writeFileSync, renameSync, unlinkSync, mkdirSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { randomUUID, createHash } from "crypto";

/**
 * Write a file atomically by writing to a temp file then renaming.
 * This prevents partial writes from corrupting files on crash.
 */
export function atomicWriteFileSync(filePath: string, content: string): void {
  const dir = dirname(filePath);
  const tmpPath = join(dir, `.${randomUUID()}.tmp`);

  try {
    writeFileSync(tmpPath, content, "utf-8");
    renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // tmp file may not exist if writeFileSync failed
    }
    throw err;
  }
}

/**
 * Ensure a directory exists (mkdir -p). Returns the path for chaining.
 */
export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Write a file only if its content has changed (SHA-256 comparison).
 * Returns true if written, false if skipped.
 */
export function writeIfChanged(filePath: string, content: string): boolean {
  if (existsSync(filePath)) {
    try {
      const existing = readFileSync(filePath, "utf-8");
      if (createHash("sha256").update(existing).digest("hex") ===
          createHash("sha256").update(content).digest("hex")) return false;
    } catch {}
  }
  atomicWriteFileSync(filePath, content);
  return true;
}
