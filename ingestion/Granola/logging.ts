import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const CODOS_PATH = process.env.CODOS_PATH || '';
const LOG_DIR = join(CODOS_PATH, 'dev/Ops/atlas/logs');
const LOG_FILE = join(LOG_DIR, 'granola.log');

type LogLevel = 'info' | 'warn' | 'error';

interface LogEvent {
  level: LogLevel;
  component: string;
  stage?: string;
  message: string;
  error?: string;
  data?: Record<string, unknown>;
  timestamp?: string;
}

function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

function normalizeError(err: unknown): string {
  if (err instanceof Error) {
    return err.stack || err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return 'Unknown error';
  }
}

export function logEvent(event: LogEvent): void {
  ensureLogDir();
  const payload = {
    timestamp: new Date().toISOString(),
    ...event,
  };
  appendFileSync(LOG_FILE, JSON.stringify(payload) + '\n');
}

export function logError(
  component: string,
  message: string,
  err: unknown,
  stage?: string,
  data?: Record<string, unknown>
): void {
  logEvent({
    level: 'error',
    component,
    stage,
    message,
    error: normalizeError(err),
    data,
  });
}
