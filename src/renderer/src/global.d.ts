import type { AudioPermissionsApi } from './types'

declare global {
  interface Window {
    audioPermissions: AudioPermissionsApi
  }
}

export {}

