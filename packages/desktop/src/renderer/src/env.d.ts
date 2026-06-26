/// <reference types="vite/client" />

import type { ExposedAPI } from '../../shared/ipc-types'

declare global {
  interface Window {
    api: ExposedAPI
  }
}
