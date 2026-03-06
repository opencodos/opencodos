/**
 * Shared timezone and date utilities for sync scripts.
 * Loads timezone from ~/.codos/paths.json, ATLAS_TIMEZONE env, or system fallback.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

let cachedTimezone: string | null = null;

/**
 * Resolve the timezone string. Resolution order:
 * 1. ~/.codos/paths.json "timezone" field
 * 2. ATLAS_TIMEZONE environment variable
 * 3. Intl.DateTimeFormat system fallback
 */
function resolveTimezone(): string {
  if (cachedTimezone) return cachedTimezone;

  // 1. Try ~/.codos/paths.json
  const configPath = join(homedir(), ".codos", "paths.json");
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, "utf-8");
      const config = JSON.parse(content);
      if (config.timezone) {
        cachedTimezone = config.timezone;
        return cachedTimezone;
      }
    } catch {
      // fall through
    }
  }

  // 2. Try ATLAS_TIMEZONE env var
  if (process.env.ATLAS_TIMEZONE) {
    cachedTimezone = process.env.ATLAS_TIMEZONE;
    return cachedTimezone;
  }

  // 3. System fallback
  cachedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return cachedTimezone;
}

/**
 * Get a formatted date string (YYYY-MM-DD) in the configured timezone.
 * @param offsetDays - Number of days to offset (negative for past)
 * @param now - Optional Date for testability
 */
export function getFormattedDate(offsetDays?: number, now?: Date): string {
  const date = now ? new Date(now) : new Date();
  if (offsetDays) {
    date.setDate(date.getDate() + offsetDays);
  }
  const tz = resolveTimezone();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Get the current time (HH:MM) in the configured timezone.
 * @param now - Optional Date for testability
 */
export function getCurrentTime(now?: Date): string {
  const date = now ?? new Date();
  const tz = resolveTimezone();
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/**
 * Get a short timezone label (e.g. "CET", "EST").
 */
export function getTimezoneLabel(): string {
  const tz = resolveTimezone();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "short",
  }).formatToParts(new Date());
  const tzPart = parts.find((p) => p.type === "timeZoneName");
  return tzPart?.value ?? tz;
}

/**
 * Get the raw IANA timezone string.
 */
export function getTimezone(): string {
  return resolveTimezone();
}

/**
 * Reset the timezone cache. Test helper.
 */
export function _resetTimezoneCache(): void {
  cachedTimezone = null;
}
