// Centralized configuration for the connector UI placeholder API

export function getApiBaseUrl(): string {
  // Empty string means same-origin (useful when you later proxy to a backend)
  if (import.meta.env.VITE_API_BASE_URL !== undefined) {
    return import.meta.env.VITE_API_BASE_URL;
  }
  return '';
}

export const config = {
  apiBaseUrl: getApiBaseUrl(),
};
