#!/usr/bin/env bun
/**
 * Granola Ingestion Hook for Claude Code
 * Returns immediately, spawns background worker for actual processing
 */

import { spawn } from 'child_process';
import { mkdirSync, openSync } from 'fs';
import { dirname, join } from 'path';

// Read stdin (required by Claude Code hooks)
let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });

process.stdin.on('end', () => {
  // Spawn worker in background (detached, won't block hook)
  const workerPath = join(dirname(import.meta.path), 'granola-worker.ts');

  // Capture worker stderr/stdout to a log file for debugging
  const logsDir = join(dirname(import.meta.path), 'logs');
  mkdirSync(logsDir, { recursive: true });
  const logFd = openSync(join(logsDir, 'granola-worker.log'), 'a');

  const child = spawn('bun', ['run', workerPath], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: process.env
  });

  // Unref so this process can exit without waiting for child
  child.unref();

  // Return immediately - don't block session start
  console.log(JSON.stringify({
    continue: true
  }));

  process.exit(0);
});
