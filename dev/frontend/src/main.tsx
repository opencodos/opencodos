import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installAtlasApiKeyFetchInterceptor } from '@/lib/atlasAuthFetch'
import { applyDesktopRuntimeNetworkOverrides } from '@/lib/desktopRuntimeBootstrap'

document.documentElement.classList.add('dark')

async function bootstrap() {
  await applyDesktopRuntimeNetworkOverrides()
  installAtlasApiKeyFetchInterceptor()

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
