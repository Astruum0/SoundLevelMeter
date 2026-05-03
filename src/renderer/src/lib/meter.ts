import type { MeterReading } from '../types'

export const MIN_DB = -72
export const MAX_DB = 0
export const DISPLAY_MAX_DB = 110
export const CALIBRATED_MAX_DB = 130
export const FRENCH_PUBLIC_WARNING_DB = 80
export const FRENCH_PUBLIC_LIMIT_DB = 102
export const CALIBRATION_OFFSET_MIN = -40
export const CALIBRATION_OFFSET_MAX = 40

const EPSILON = 1e-8
const PEAK_FALL_STEP = 0.02
const DB_RISE_SMOOTHING = 0.32
const DB_FALL_SMOOTHING = 0.12
const NEEDLE_SMOOTHING = 0.08

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max)
}

const smoothValue = (current: number, target: number, factor: number): number => {
  return current + (target - current) * factor
}

export const calculateRms = (samples: Float32Array<ArrayBuffer>): number => {
  if (samples.length === 0) {
    return 0
  }

  let sum = 0

  for (const sample of samples) {
    sum += sample * sample
  }

  return Math.sqrt(sum / samples.length)
}

export const rmsToDb = (rms: number, minDb = MIN_DB): number => {
  if (!Number.isFinite(rms) || rms <= EPSILON) {
    return minDb
  }

  return clamp(20 * Math.log10(rms), minDb, MAX_DB)
}

export const normalizeDb = (db: number, minDb = MIN_DB, maxDb = MAX_DB): number => {
  if (minDb >= maxDb) {
    return 0
  }

  return (clamp(db, minDb, maxDb) - minDb) / (maxDb - minDb)
}

export const dbfsToDisplayDb = (dbfs: number): number => {
  return clamp(normalizeDb(dbfs) * DISPLAY_MAX_DB, 0, DISPLAY_MAX_DB)
}

export const clampCalibrationOffset = (offset: number): number => {
  if (!Number.isFinite(offset)) {
    return 0
  }

  return clamp(Math.round(offset), CALIBRATION_OFFSET_MIN, CALIBRATION_OFFSET_MAX)
}

export const applyCalibrationOffset = (displayDb: number, offset: number): number => {
  return clamp(displayDb + clampCalibrationOffset(offset), 0, CALIBRATED_MAX_DB)
}

export const getFrenchPublicLevelTone = (
  displayDb: number
): 'safe' | 'warning' | 'danger' => {
  if (displayDb >= FRENCH_PUBLIC_LIMIT_DB) {
    return 'danger'
  }

  if (displayDb >= FRENCH_PUBLIC_WARNING_DB) {
    return 'warning'
  }

  return 'safe'
}

export const createMeterReading = (
  samples: Float32Array<ArrayBuffer>,
  previousPeak = 0,
  previousDb = MIN_DB,
  previousNeedle = 0
): MeterReading => {
  const rawDb = rmsToDb(calculateRms(samples))
  const db = smoothValue(
    previousDb,
    rawDb,
    rawDb > previousDb ? DB_RISE_SMOOTHING : DB_FALL_SMOOTHING
  )
  const normalized = normalizeDb(db)
  const peak = Math.max(normalized, previousPeak - PEAK_FALL_STEP)
  const needle = smoothValue(previousNeedle, normalized, NEEDLE_SMOOTHING)

  return {
    db,
    normalized,
    needle,
    peak
  }
}
