import { appendFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { loadEnv, loadPaths } from "./paths";
import { withRetry } from "./retry";

const PIPEDREAM_API_BASE = "https://api.pipedream.com";

export type PipedreamService =
  | "slack"
  | "gmail"
  | "googlecalendar"
  | "github"
  | "linear"
  | "notion";

interface PipedreamCredentials {
  projectId: string;
  clientId: string;
  clientSecret: string;
  environment: string;
  externalUserId: string;
}

interface TokenCache {
  token: string;
  expiresAt: number; // epoch ms
}

let tokenCache: TokenCache | null = null;

const SERVICE_ACCOUNT_ENV: Record<PipedreamService, string> = {
  slack: "PIPEDREAM_ACCOUNT_ID_SLACK",
  gmail: "PIPEDREAM_ACCOUNT_ID_GMAIL",
  googlecalendar: "PIPEDREAM_ACCOUNT_ID_GOOGLECALENDAR",
  github: "PIPEDREAM_ACCOUNT_ID_GITHUB",
  linear: "PIPEDREAM_ACCOUNT_ID_LINEAR",
  notion: "PIPEDREAM_ACCOUNT_ID_NOTION",
};

function getEnvValue(key: string, env: Record<string, string>): string {
  return env[key] || process.env[key] || "";
}

export function getPipedreamCredentials(): PipedreamCredentials | null {
  const env = loadEnv();
  const ensuredExternalUserId = ensureExternalUserId(env);
  const projectId = getEnvValue("PIPEDREAM_PROJECT_ID", env);
  const clientId = getEnvValue("PIPEDREAM_CLIENT_ID", env);
  const clientSecret = getEnvValue("PIPEDREAM_CLIENT_SECRET", env);
  const environment =
    getEnvValue("PIPEDREAM_ENV", env) ||
    getEnvValue("PIPEDREAM_PROJECT_ENVIRONMENT", env) ||
    "production";
  const externalUserId = ensuredExternalUserId || getEnvValue("PIPEDREAM_EXTERNAL_USER_ID", env);

  if (!projectId || !clientId || !clientSecret || !externalUserId) return null;

  return { projectId, clientId, clientSecret, environment, externalUserId };
}

function ensureExternalUserId(env: Record<string, string>): string | null {
  const existing = getEnvValue("PIPEDREAM_EXTERNAL_USER_ID", env);
  if (existing) return existing;

  const { codosPath } = loadPaths();
  const envPath = join(codosPath, "dev", "Ops", ".env");
  const newId = randomUUID();

  try {
    const line = `PIPEDREAM_EXTERNAL_USER_ID=${newId}\n`;
    if (existsSync(envPath)) {
      appendFileSync(envPath, line);
    } else {
      writeFileSync(envPath, line, "utf-8");
    }
    env["PIPEDREAM_EXTERNAL_USER_ID"] = newId;
    process.env.PIPEDREAM_EXTERNAL_USER_ID = newId;
    return newId;
  } catch (error) {
    console.error("Failed to persist PIPEDREAM_EXTERNAL_USER_ID:", error);
    return null;
  }
}

export function getPipedreamAccountId(service: PipedreamService): string | null {
  const env = loadEnv();
  const key = SERVICE_ACCOUNT_ENV[service];
  const value = getEnvValue(key, env);
  return value || null;
}

export function isPipedreamReady(service: PipedreamService): boolean {
  return Boolean(getPipedreamCredentials() && getPipedreamAccountId(service));
}

function toBase64Url(input: string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function appendParams(url: string, params?: Record<string, any>): string {
  if (!params || Object.keys(params).length === 0) return url;
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        parsed.searchParams.append(key, String(item));
      }
    } else {
      parsed.searchParams.set(key, String(value));
    }
  }
  return parsed.toString();
}

async function getAccessToken(creds: PipedreamCredentials): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now) {
    return tokenCache.token;
  }

  const response = await fetch(`${PIPEDREAM_API_BASE}/v1/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-pd-environment": creds.environment,
    },
    body: JSON.stringify({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: "client_credentials",
      scope: "*",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Pipedream token error (${response.status}): ${text}`);
  }

  const data = await response.json();
  const token = data.access_token as string | undefined;
  const expiresIn = Number(data.expires_in || 0);
  if (!token) throw new Error("Missing access_token from Pipedream");

  // Cache with 2 min buffer
  const bufferMs = 2 * 60 * 1000;
  const expiresAt = now + Math.max(expiresIn * 1000 - bufferMs, 0);
  tokenCache = { token, expiresAt };

  return token;
}

function buildProxyHeaders(headers?: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;
  for (const [key, value] of Object.entries(headers)) {
    result[`x-pd-proxy-${key}`] = value;
  }
  return result;
}

async function proxyRequest(
  method: "GET" | "POST",
  service: PipedreamService,
  url: string,
  options?: {
    params?: Record<string, any>;
    headers?: Record<string, string>;
    body?: Record<string, any>;
  }
): Promise<any> {
  const creds = getPipedreamCredentials();
  const accountId = getPipedreamAccountId(service);
  if (!creds) {
    throw new Error("Pipedream credentials are not configured");
  }
  if (!accountId) {
    throw new Error(`Pipedream account ID not configured for ${service}`);
  }

  const urlWithParams = appendParams(url, options?.params);
  const url64 = toBase64Url(urlWithParams);
  const proxyUrl = `${PIPEDREAM_API_BASE}/v1/connect/${creds.projectId}/proxy/${url64}?external_user_id=${encodeURIComponent(
    creds.externalUserId
  )}&account_id=${encodeURIComponent(accountId)}`;

  const downstreamHeaders = buildProxyHeaders(options?.headers);

  return withRetry(
    async () => {
      // Token refresh inside retry lambda so expired tokens get refreshed on retry
      const token = await getAccessToken(creds);

      const response = await fetch(proxyUrl, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "x-pd-environment": creds.environment,
          ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
          ...downstreamHeaders,
        },
        body: method === "POST" ? JSON.stringify(options?.body || {}) : undefined,
      });

      if (!response.ok) {
        // Clear token cache on auth errors so next retry gets a fresh token
        if (response.status === 401 || response.status === 403) {
          tokenCache = null;
        }
        const text = await response.text();
        throw new Error(`Pipedream proxy error (${response.status}): ${text}`);
      }

      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json") || contentType === "") {
        return await response.json();
      }

      return await response.text();
    },
    { maxAttempts: 3, baseDelay: 5000, label: `pipedream:${service}` },
  );
}

export async function pipedreamProxyGet(
  service: PipedreamService,
  url: string,
  options?: { params?: Record<string, any>; headers?: Record<string, string> }
): Promise<any> {
  return proxyRequest("GET", service, url, options);
}

export async function pipedreamProxyPost(
  service: PipedreamService,
  url: string,
  options?: { params?: Record<string, any>; headers?: Record<string, string>; body?: Record<string, any> }
): Promise<any> {
  return proxyRequest("POST", service, url, options);
}
