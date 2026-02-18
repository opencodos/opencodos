import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { logEvent } from './logging';

const CODOS_PATH = process.env.CODOS_PATH || '';
const ATLAS_BOT_ENV_PATH = join(CODOS_PATH, 'ingestion/atlas-bot/.env');

interface BotEnv {
  token?: string;
  authorizedUsers?: string[];
}

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const content = readFileSync(path, 'utf-8');
  const lines = content.split('\n');
  const env: Record<string, string> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    value = value.replace(/^['"]|['"]$/g, '');
    env[key] = value;
  }
  return env;
}

function loadBotEnv(): BotEnv {
  const fileEnv = parseEnvFile(ATLAS_BOT_ENV_PATH);
  const token = process.env.TELEGRAM_BOT_TOKEN || fileEnv.TELEGRAM_BOT_TOKEN;
  const usersRaw = process.env.AUTHORIZED_USER_IDS || fileEnv.AUTHORIZED_USER_IDS || '';
  const authorizedUsers = usersRaw
    .split(',')
    .map(u => u.trim())
    .filter(Boolean);

  return { token, authorizedUsers };
}

export async function notifyFailure(message: string): Promise<void> {
  const { token, authorizedUsers } = loadBotEnv();

  if (!token || !authorizedUsers || authorizedUsers.length === 0) {
    logEvent({
      level: 'warn',
      component: 'granola-notify',
      message: 'Telegram notification skipped: missing token or authorized users',
    });
    return;
  }

  const chatId = authorizedUsers[0];
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        disable_web_page_preview: true,
      }),
    });

    if (!resp.ok) {
      logEvent({
        level: 'warn',
        component: 'granola-notify',
        message: `Telegram notification failed: ${resp.status}`,
      });
    }
  } catch (err) {
    logEvent({
      level: 'warn',
      component: 'granola-notify',
      message: 'Telegram notification threw error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
