export type PermissionState =
  | 'not-determined'
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'unknown'

export interface AudioInputDevice {
  deviceId: string
  groupId: string
  label: string
}

export interface MeterReading {
  db: number
  normalized: number
  needle: number
  peak: number
}

export interface AudioPermissionsApi {
  getStatus: () => Promise<PermissionState>
  request: () => Promise<boolean>
}
