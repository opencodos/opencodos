/**
 * Shared authentication utilities for Vault API access
 */

import { getDesktopAtlasApiKey } from '@/lib/desktopRuntimeBootstrap'

export const authHeaders = (): Record<string, string> => {
  const key = getDesktopAtlasApiKey() || import.meta.env.VITE_ATLAS_API_KEY || ''
  return key ? { 'X-Atlas-Key': key } : {}
}
