import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

import {
  CALIBRATED_MAX_DB,
  DISPLAY_MAX_DB,
  MIN_DB,
  applyCalibrationOffset,
  clampCalibrationOffset,
  createMeterReading,
  dbfsToDisplayDb,
  getFrenchPublicLevelTone
} from './lib/meter'
import type { AudioInputDevice, MeterReading, PermissionState } from './types'

const STORAGE_KEY = 'sound-level-meter:selected-input'
const CALIBRATION_STORAGE_KEY = 'sound-level-meter:calibration-offset'
const MIN_NEEDLE_ANGLE = -95
const MAX_NEEDLE_ANGLE = 95
const METER_UI_UPDATE_INTERVAL_MS = 500

const DEFAULT_READING: MeterReading = {
  db: MIN_DB,
  normalized: 0,
  needle: 0,
  peak: 0
}

const readStoredInputId = (): string => {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

const persistInputId = (deviceId: string): void => {
  try {
    localStorage.setItem(STORAGE_KEY, deviceId)
  } catch {
    // Ignore storage write failures and keep the current session working.
  }
}

const readStoredCalibrationOffset = (): number => {
  try {
    return clampCalibrationOffset(Number(localStorage.getItem(CALIBRATION_STORAGE_KEY)))
  } catch {
    return 0
  }
}

const persistCalibrationOffset = (offset: number): void => {
  try {
    localStorage.setItem(CALIBRATION_STORAGE_KEY, String(clampCalibrationOffset(offset)))
  } catch {
    // Ignore storage write failures and keep the current session working.
  }
}

const mapAudioInputs = (devices: MediaDeviceInfo[]): AudioInputDevice[] => {
  let unnamedIndex = 1

  return devices
    .filter((device) => device.kind === 'audioinput')
    .map((device) => {
      const label = device.label.trim() || `Microphone ${unnamedIndex++}`

      return {
        deviceId: device.deviceId,
        groupId: device.groupId,
        label
      }
    })
}

const listAudioInputs = async (): Promise<AudioInputDevice[]> => {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return mapAudioInputs(devices)
}

const isUnavailableDeviceError = (error: unknown): boolean => {
  return error instanceof DOMException &&
    (error.name === 'NotFoundError' || error.name === 'OverconstrainedError')
}

const describePermission = (permission: PermissionState): string => {
  switch (permission) {
    case 'not-determined':
      return 'Microphone access is required to read the live input level.'
    case 'denied':
    case 'restricted':
      return 'Microphone access is blocked. Re-enable it in System Settings > Privacy & Security > Microphone.'
    default:
      return 'Microphone access is unavailable right now.'
  }
}

const describeStreamError = (error: unknown): string => {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') {
      return 'The selected microphone is not accessible until permission is granted.'
    }

    if (error.name === 'NotReadableError') {
      return 'The microphone is already in use by another app or could not be opened.'
    }
  }

  return 'The microphone stream could not be started.'
}

export function App() {
  const initialSelectedInput = readStoredInputId()
  const initialCalibrationOffset = readStoredCalibrationOffset()

  const [permission, setPermission] = useState<PermissionState>('unknown')
  const [inputs, setInputs] = useState<AudioInputDevice[]>([])
  const [selectedInputId, setSelectedInputId] = useState(initialSelectedInput)
  const [calibrationOffset, setCalibrationOffset] = useState(initialCalibrationOffset)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [meter, setMeter] = useState<MeterReading>(DEFAULT_READING)
  const [displayDbfs, setDisplayDbfs] = useState(MIN_DB)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [isRequestingPermission, setIsRequestingPermission] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)

  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const sampleBufferRef = useRef<Float32Array<ArrayBuffer> | null>(null)
  const meterRunRef = useRef(0)
  const selectedInputRef = useRef(initialSelectedInput)
  const liveMeterRef = useRef<MeterReading>(DEFAULT_READING)
  const lastMeterCommitTimeRef = useRef(0)

  useEffect(() => {
    selectedInputRef.current = selectedInputId
  }, [selectedInputId])

  const teardownAudio = async (): Promise<void> => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    sourceRef.current?.disconnect()
    analyserRef.current?.disconnect()
    streamRef.current?.getTracks().forEach((track) => track.stop())

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      await audioContextRef.current.close()
    }

    sourceRef.current = null
    analyserRef.current = null
    streamRef.current = null
    audioContextRef.current = null
    sampleBufferRef.current = null
    liveMeterRef.current = DEFAULT_READING
    lastMeterCommitTimeRef.current = 0
  }

  const refreshInputs = async (): Promise<void> => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setStreamError('This environment does not expose media device enumeration.')
      return
    }

    const nextInputs = await listAudioInputs()
    setInputs(nextInputs)

    if (selectedInputRef.current && !nextInputs.some((input) => input.deviceId === selectedInputRef.current)) {
      persistInputId('')
      selectedInputRef.current = ''
      setSelectedInputId('')
    }
  }

  const startMeter = async (deviceId: string): Promise<void> => {
    const runId = meterRunRef.current + 1
    meterRunRef.current = runId
    setIsConnecting(true)
    setStreamError(null)
    setMeter(DEFAULT_READING)
    setDisplayDbfs(MIN_DB)

    await teardownAudio()
    liveMeterRef.current = DEFAULT_READING
    lastMeterCommitTimeRef.current = performance.now() - METER_UI_UPDATE_INTERVAL_MS

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      })

      if (runId !== meterRunRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      const audioContext = new AudioContext()
      await audioContext.resume()

      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.16

      const source = audioContext.createMediaStreamSource(stream)
      source.connect(analyser)

      const sampleBuffer = new Float32Array(analyser.fftSize)

      audioContextRef.current = audioContext
      analyserRef.current = analyser
      sourceRef.current = source
      streamRef.current = stream
      sampleBufferRef.current = sampleBuffer

      const tick = (): void => {
        if (runId !== meterRunRef.current || !analyserRef.current || !sampleBufferRef.current) {
          return
        }

        analyserRef.current.getFloatTimeDomainData(sampleBufferRef.current)
        const now = performance.now()
        const nextReading = createMeterReading(
          sampleBufferRef.current,
          liveMeterRef.current.peak,
          liveMeterRef.current.db,
          liveMeterRef.current.needle
        )

        liveMeterRef.current = nextReading
        setMeter(nextReading)

        if (now - lastMeterCommitTimeRef.current >= METER_UI_UPDATE_INTERVAL_MS) {
          lastMeterCommitTimeRef.current = now
          setDisplayDbfs(nextReading.db)
        }

        animationFrameRef.current = requestAnimationFrame(tick)
      }

      animationFrameRef.current = requestAnimationFrame(tick)
      await refreshInputs()
    } catch (error) {
      if (deviceId && isUnavailableDeviceError(error)) {
        persistInputId('')
        setSelectedInputId('')
        return
      }

      const nextPermission = await window.audioPermissions.getStatus()
      setPermission(nextPermission)
      setStreamError(
        nextPermission === 'granted' ? describeStreamError(error) : describePermission(nextPermission)
      )
    } finally {
      if (runId === meterRunRef.current) {
        setIsConnecting(false)
      }
    }
  }

  useEffect(() => {
    let isActive = true

    const bootstrap = async (): Promise<void> => {
      const nextPermission = await window.audioPermissions.getStatus()

      if (!isActive) {
        return
      }

      setPermission(nextPermission)
    }

    const handleDeviceChange = (): void => {
      void refreshInputs()
    }

    void bootstrap()
    navigator.mediaDevices?.addEventListener?.('devicechange', handleDeviceChange)

    return () => {
      isActive = false
      navigator.mediaDevices?.removeEventListener?.('devicechange', handleDeviceChange)
      meterRunRef.current += 1
      void teardownAudio()
    }
  }, [])

  useEffect(() => {
    if (permission !== 'granted') {
      return
    }

    void refreshInputs()
  }, [permission])

  useEffect(() => {
    if (permission !== 'granted') {
      return
    }

    void startMeter(selectedInputId)
  }, [permission, selectedInputId])

  const requestMicrophoneAccess = async (): Promise<void> => {
    setIsRequestingPermission(true)
    setStreamError(null)

    try {
      await window.audioPermissions.request()
      setPermission(await window.audioPermissions.getStatus())
    } finally {
      setIsRequestingPermission(false)
    }
  }

  const handleInputChange = (event: Event): void => {
    const target = event.currentTarget as HTMLSelectElement
    const nextDeviceId = target.value

    persistInputId(nextDeviceId)
    selectedInputRef.current = nextDeviceId
    setSelectedInputId(nextDeviceId)
  }

  const updateCalibrationOffset = (nextOffset: number): void => {
    const clampedOffset = clampCalibrationOffset(nextOffset)

    setCalibrationOffset(clampedOffset)
    persistCalibrationOffset(clampedOffset)
  }

  const hasLiveReading = permission === 'granted' && !isConnecting && !streamError
  const rawDisplayDb = hasLiveReading ? dbfsToDisplayDb(displayDbfs) : 0
  const displayDb = hasLiveReading ? applyCalibrationOffset(rawDisplayDb, calibrationOffset) : 0
  const roundedDisplayDb = Math.round(displayDb)
  const tone = hasLiveReading ? getFrenchPublicLevelTone(displayDb) : 'neutral'
  const isSettingsForcedOpen = permission !== 'granted' || Boolean(streamError)
  const isSettingsExpanded = isSettingsOpen || isSettingsForcedOpen
  const needleDb = hasLiveReading
    ? applyCalibrationOffset(meter.needle * DISPLAY_MAX_DB, calibrationOffset)
    : 0
  const needleAngle =
    MIN_NEEDLE_ANGLE + (needleDb / CALIBRATED_MAX_DB) * (MAX_NEEDLE_ANGLE - MIN_NEEDLE_ANGLE)
  const needleStyle = {
    '--needle-angle': `${needleAngle}deg`
  } as JSX.CSSProperties

  return (
    <div class="app-shell">
      <main class={`dashboard tone-${tone}`}>
        <div class="speedometer" aria-hidden="true">
          <div class="speedometer-needle" style={needleStyle}>
            <div class="speedometer-needle-line" />
            <div class="speedometer-needle-cap" />
          </div>
        </div>

        <div class="db-stage">
          <div class="db-number">{roundedDisplayDb}</div>
          <div class="db-unit">dB</div>
        </div>

        <div class={`controls ${isSettingsExpanded ? 'is-open' : 'is-closed'}`}>
          <button
            class="settings-toggle"
            type="button"
            aria-expanded={isSettingsExpanded}
            onClick={() => setIsSettingsOpen((current) => !current)}
          >
            <span class="settings-title">Settings</span>
            <span class={`settings-chevron ${isSettingsExpanded ? 'is-open' : ''}`} aria-hidden="true" />
          </button>

          <div class={`settings-panel ${isSettingsExpanded ? 'is-open' : 'is-closed'}`}>
            <div class="settings-panel-inner">
              <select
                class="select-input"
                disabled={permission !== 'granted' || isConnecting}
                value={selectedInputId}
                onChange={handleInputChange}
              >
                <option value="">System Default</option>
                {inputs.map((input) => (
                  <option
                    key={input.deviceId}
                    value={input.deviceId}
                  >
                    {input.label}
                  </option>
                ))}
              </select>

              <div class="calibration-strip">
                <span class="calibration-label">Calibration</span>
                <div class="calibration-actions">
                  <button
                    class="calibration-button"
                    type="button"
                    onClick={() => updateCalibrationOffset(calibrationOffset - 1)}
                  >
                    -1
                  </button>
                  <button
                    class="calibration-readout"
                    type="button"
                    title="Reset calibration offset"
                    onClick={() => updateCalibrationOffset(0)}
                  >
                    {calibrationOffset > 0 ? '+' : ''}
                    {calibrationOffset} dB
                  </button>
                  <button
                    class="calibration-button"
                    type="button"
                    onClick={() => updateCalibrationOffset(calibrationOffset + 1)}
                  >
                    +1
                  </button>
                </div>
              </div>

              {permission !== 'granted' || streamError ? (
                <div class="message-card">
                  <p>{streamError ?? describePermission(permission)}</p>
                  {permission !== 'granted' ? (
                    <button
                      class="action-button"
                      type="button"
                      disabled={isRequestingPermission}
                      onClick={() => void requestMicrophoneAccess()}
                    >
                      {isRequestingPermission ? 'Requesting access...' : 'Grant microphone access'}
                    </button>
                  ) : (
                    <button
                      class="action-button"
                      type="button"
                      disabled={isConnecting}
                      onClick={() => void startMeter(selectedInputId)}
                    >
                      {isConnecting ? 'Connecting...' : 'Retry audio stream'}
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
