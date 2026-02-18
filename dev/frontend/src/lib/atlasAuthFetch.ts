import { API_BASE_URL } from '@/lib/api'
import { getDesktopAtlasApiKey } from '@/lib/desktopRuntimeBootstrap'

type FetchInput = Parameters<typeof fetch>[0]

const DEFAULT_API_BASES = ['http://localhost:8767', 'http://127.0.0.1:8767']

function normalizeBase(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url
}

function shouldAttachAtlasKey(url: string, bases: string[]): boolean {
  return bases.some((base) => url === base || url.startsWith(`${base}/`))
}

export function installAtlasApiKeyFetchInterceptor(): void {
  const originalFetch = window.fetch.bind(window)
  const apiBases = Array.from(new Set([normalizeBase(API_BASE_URL), ...DEFAULT_API_BASES.map(normalizeBase)]))

  window.fetch = ((input: FetchInput, init?: RequestInit) => {
    const request = new Request(input, init)
    if (request.headers.has('X-Atlas-Key')) {
      return originalFetch(request)
    }

    const atlasKey = (getDesktopAtlasApiKey() || import.meta.env.VITE_ATLAS_API_KEY || '').trim()
    if (!atlasKey || !shouldAttachAtlasKey(request.url, apiBases)) {
      return originalFetch(request)
    }

    request.headers.set('X-Atlas-Key', atlasKey)
    return originalFetch(request)
  }) as typeof window.fetch
}
