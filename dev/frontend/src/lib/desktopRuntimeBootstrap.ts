import {
  getDesktopRuntimeBootstrapStatus,
  isDesktopRuntimeAvailable,
  type DesktopRuntimeBootstrapStatus,
} from '@/lib/desktopRuntime'

type FetchInput = Parameters<typeof fetch>[0]

let _cachedBootstrap: DesktopRuntimeBootstrapStatus | null = null

export function getDesktopAtlasApiKey(): string | null {
  return _cachedBootstrap?.atlasApiKey || null
}

const HTTP_DEFAULTS = ['http://localhost:8767', 'http://127.0.0.1:8767']
const WS_DEFAULTS = ['ws://localhost:8767', 'ws://127.0.0.1:8767']

function rewriteUrl(url: string, fromPrefixes: string[], toPrefix: string): string {
  for (const prefix of fromPrefixes) {
    if (url.startsWith(prefix)) {
      return `${toPrefix}${url.slice(prefix.length)}`
    }
  }
  return url
}


function isBackendUrl(url: string, targetBaseUrl: string): boolean {
  const normalize = (v: string) => (v.endsWith('/') ? v.slice(0, -1) : v)
  const bases = [normalize(targetBaseUrl), ...HTTP_DEFAULTS.map(normalize)]
  return bases.some((b) => url === b || url.startsWith(`${b}/`))
}

/**
 * XHR-based fetch replacement for all backend requests in Tauri.
 *
 * WKWebView's native fetch has multiple issues:
 *   1. fetch(url, init) ignores init.method — always sends GET
 *   2. fetch(Request) converts body to ReadableStream — can't upload it
 *   3. Custom headers (like X-Atlas-Key) are silently dropped on cross-origin requests
 * XHR doesn't have any of these issues.
 */
function xhrFetch(url: string, init: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(init.method || 'GET', url, true)

    // Set headers
    const headers = init.headers
    if (headers) {
      if (headers instanceof Headers) {
        headers.forEach((v, k) => xhr.setRequestHeader(k, v))
      } else if (Array.isArray(headers)) {
        headers.forEach(([k, v]) => xhr.setRequestHeader(k, v))
      } else {
        Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v))
      }
    }

    // Abort support
    if (init.signal) {
      if (init.signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return }
      init.signal.addEventListener('abort', () => {
        xhr.abort()
        reject(new DOMException('Aborted', 'AbortError'))
      })
    }

    xhr.onload = () => {
      const respHeaders = new Headers()
      xhr.getAllResponseHeaders().trim().split('\r\n').forEach((line) => {
        const idx = line.indexOf(': ')
        if (idx > 0) respHeaders.set(line.slice(0, idx), line.slice(idx + 2))
      })
      resolve(new Response(xhr.responseText, {
        status: xhr.status,
        statusText: xhr.statusText,
        headers: respHeaders,
      }))
    }
    xhr.onerror = () => reject(new TypeError('Network request failed'))
    xhr.ontimeout = () => reject(new TypeError('Network request timed out'))

    xhr.send(init.body as string | null ?? null)
  })
}

function installFetchRewrite(targetBaseUrl: string, atlasApiKey: string) {
  const originalFetch = window.fetch.bind(window)
  window.fetch = ((input: FetchInput, init?: RequestInit) => {
    // Resolve URL
    let url: string
    if (typeof input === 'string') {
      url = rewriteUrl(input, HTTP_DEFAULTS, targetBaseUrl)
    } else if (input instanceof URL) {
      url = rewriteUrl(input.toString(), HTTP_DEFAULTS, targetBaseUrl)
    } else if (input instanceof Request) {
      url = rewriteUrl(input.url, HTTP_DEFAULTS, targetBaseUrl)
    } else {
      return originalFetch(input, init)
    }

    // Build effective init (merge Request properties if input was a Request)
    const effectiveInit: RequestInit = { ...init }
    if (input instanceof Request) {
      if (!effectiveInit.method) effectiveInit.method = input.method
      if (!effectiveInit.headers) effectiveInit.headers = Object.fromEntries(input.headers.entries())
    }

    // Inject atlas key (case-insensitive check to avoid duplicates —
    // Headers API lowercases names, and XHR concatenates duplicate headers
    // which breaks hmac.compare_digest on the backend).
    if (atlasApiKey && isBackendUrl(url, targetBaseUrl)) {
      const hdrs = { ...(effectiveInit.headers ?? {}) } as Record<string, string>
      for (const k of Object.keys(hdrs)) {
        if (k.toLowerCase() === 'x-atlas-key') delete hdrs[k]
      }
      hdrs['X-Atlas-Key'] = atlasApiKey
      effectiveInit.headers = hdrs
    }

    // Use XHR for ALL backend requests — WKWebView's native fetch silently
    // drops custom headers (like X-Atlas-Key) on cross-origin requests.
    if (isBackendUrl(url, targetBaseUrl)) {
      // Body may live in the Request object when called from the outer
      // atlasAuthFetch interceptor (which passes a Request, not url+init).
      if (!effectiveInit.body && input instanceof Request && input.body) {
        return input.text().then(bodyText => {
          effectiveInit.body = bodyText
          return xhrFetch(url, effectiveInit)
        })
      }
      return xhrFetch(url, effectiveInit)
    }

    // Non-backend URLs: pass through to native fetch
    const request = new Request(url, effectiveInit)
    return originalFetch(request)
  }) as typeof window.fetch
}

function installWebSocketRewrite(targetWsUrl: string) {
  const OriginalWebSocket = window.WebSocket

  class RewrittenWebSocket extends OriginalWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      const nextUrl = rewriteUrl(url.toString(), WS_DEFAULTS, targetWsUrl)
      super(nextUrl, protocols)
    }
  }

  Object.defineProperty(window, 'WebSocket', {
    configurable: true,
    writable: true,
    value: RewrittenWebSocket,
  })
}

/**
 * Poll the backend /health endpoint until it responds.
 * This gates app rendering until the backend is actually ready,
 * preventing "Could not connect to the server" errors on first load.
 */
async function waitForBackend(baseUrl: string, maxWaitMs = 15000): Promise<void> {
  const start = Date.now()
  let delay = 100

  while (Date.now() - start < maxWaitMs) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 2000)
      const response = await fetch(`${baseUrl}/health`, { signal: controller.signal })
      clearTimeout(timeoutId)
      if (response.ok) return
    } catch {
      // Connection refused, CORS error, timeout — all expected while backend is starting
    }

    await new Promise(resolve => setTimeout(resolve, delay))
    delay = Math.min(delay * 1.5, 1000)
  }

  // Don't throw — let the app render anyway after timeout.
  // Better to show errors than hang forever.
  console.warn('[Desktop] Backend did not become ready within', maxWaitMs, 'ms')
}

export async function applyDesktopRuntimeNetworkOverrides(): Promise<void> {
  if (!isDesktopRuntimeAvailable()) {
    return
  }

  try {
    const bootstrap = await getDesktopRuntimeBootstrapStatus()
    _cachedBootstrap = bootstrap
    ;(window as unknown as Record<string, unknown>).__CODOS_DESKTOP_BOOTSTRAP__ = bootstrap

    const targetBaseUrl = bootstrap.backendBaseUrl
    const targetWsUrl = bootstrap.backendWsUrl

    const needsHttpRewrite = !HTTP_DEFAULTS.includes(targetBaseUrl)
    const needsWsRewrite = !WS_DEFAULTS.includes(targetWsUrl)
    const atlasApiKey = bootstrap.atlasApiKey || ''

    if (needsHttpRewrite || Boolean(atlasApiKey)) {
      installFetchRewrite(targetBaseUrl, atlasApiKey)
    }
    if (needsWsRewrite) {
      installWebSocketRewrite(targetWsUrl)
    }

    // Wait for backend to be ready before rendering the app
    await waitForBackend(targetBaseUrl)
  } catch {
    // Ignore bootstrap failures in browser/non-desktop contexts.
  }
}
