import { contextBridge, ipcRenderer } from 'electron'

type PermissionState =
  | 'not-determined'
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'unknown'

const audioPermissions = {
  getStatus: () => ipcRenderer.invoke('audio-permission:get-status') as Promise<PermissionState>,
  request: () => ipcRenderer.invoke('audio-permission:request') as Promise<boolean>
}

contextBridge.exposeInMainWorld('audioPermissions', audioPermissions)

