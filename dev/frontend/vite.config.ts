import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const BUILD_HASH_EXPERIMENTAL = 'dev'
const BUILD_HASH_UNKNOWN = 'unknown'

function getAppVersion(): string {
  try {
    return fs.readFileSync(path.resolve(__dirname, '../../VERSION'), 'utf-8').trim()
  } catch {
    return '0.0.0'
  }
}

// Generate build info at build time
function getBuildInfo() {
  const buildDatetime = new Date().toISOString()

  let buildHash = BUILD_HASH_EXPERIMENTAL
  try {
    // Check if there are uncommitted changes
    const status = execSync('git status --porcelain', { encoding: 'utf-8' }).trim()
    const gitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
    if (status === '') {
      buildHash = gitHash
    } else {
      buildHash = `${gitHash}-${BUILD_HASH_EXPERIMENTAL}`
    }
  } catch {
    // Git not available or not a git repo
    buildHash = BUILD_HASH_UNKNOWN
  }

  return { buildDatetime, buildHash }
}

const { buildDatetime, buildHash } = getBuildInfo()
const appVersion = getAppVersion()

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __BUILD_DATETIME__: JSON.stringify(buildDatetime),
    __BUILD_HASH__: JSON.stringify(buildHash),
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8767',
        changeOrigin: true,
      },
      '/telegram': {
        target: 'http://127.0.0.1:8767',
        changeOrigin: true,
      },
    },
  },
})
