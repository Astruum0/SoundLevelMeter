import { describe, expect, it } from 'vitest'

import {
  CALIBRATED_MAX_DB,
  CALIBRATION_OFFSET_MAX,
  CALIBRATION_OFFSET_MIN,
  DISPLAY_MAX_DB,
  FRENCH_PUBLIC_LIMIT_DB,
  FRENCH_PUBLIC_WARNING_DB,
  MAX_DB,
  MIN_DB,
  applyCalibrationOffset,
  clampCalibrationOffset,
  createMeterReading,
  dbfsToDisplayDb,
  getFrenchPublicLevelTone,
  normalizeDb,
  rmsToDb
} from './meter'

describe('rmsToDb', () => {
  it('clamps silence to the minimum dB floor', () => {
    expect(rmsToDb(0)).toBe(MIN_DB)
  })

  it('maps full-scale input to 0 dB', () => {
    expect(rmsToDb(1)).toBe(MAX_DB)
  })
})

describe('normalizeDb', () => {
  it('maps the dB range into 0..1', () => {
    expect(normalizeDb(MIN_DB)).toBe(0)
    expect(normalizeDb(MAX_DB)).toBe(1)
  })

  it('clamps values outside the expected range', () => {
    expect(normalizeDb(MAX_DB + 12)).toBe(1)
    expect(normalizeDb(MIN_DB - 12)).toBe(0)
  })
})

describe('createMeterReading', () => {
  it('preserves a decaying peak hold', () => {
    const silentFrame = new Float32Array(512)

    expect(createMeterReading(silentFrame, 0.9).peak).toBeCloseTo(0.88, 5)
  })

  it('keeps a slower trailing needle behind the main reading', () => {
    const silentFrame = new Float32Array(512)
    const reading = createMeterReading(silentFrame, 0.4, MIN_DB, 0.5)

    expect(reading.needle).toBeCloseTo(0.46, 5)
    expect(reading.needle).toBeGreaterThan(reading.peak)
  })
})

describe('dbfsToDisplayDb', () => {
  it('maps the normalized reading into a positive dB display range', () => {
    expect(dbfsToDisplayDb(MIN_DB)).toBe(0)
    expect(dbfsToDisplayDb(MAX_DB)).toBe(DISPLAY_MAX_DB)
  })
})

describe('clampCalibrationOffset', () => {
  it('limits the saved calibration offset to the supported range', () => {
    expect(clampCalibrationOffset(CALIBRATION_OFFSET_MIN - 10)).toBe(CALIBRATION_OFFSET_MIN)
    expect(clampCalibrationOffset(CALIBRATION_OFFSET_MAX + 10)).toBe(CALIBRATION_OFFSET_MAX)
  })
})

describe('applyCalibrationOffset', () => {
  it('applies the offset while keeping the visible reading in range', () => {
    expect(applyCalibrationOffset(90, 5)).toBe(95)
    expect(applyCalibrationOffset(DISPLAY_MAX_DB, 50)).toBe(CALIBRATED_MAX_DB)
  })
})

describe('getFrenchPublicLevelTone', () => {
  it('uses the French public amplified-sound thresholds', () => {
    expect(getFrenchPublicLevelTone(FRENCH_PUBLIC_WARNING_DB - 0.1)).toBe('safe')
    expect(getFrenchPublicLevelTone(FRENCH_PUBLIC_WARNING_DB)).toBe('warning')
    expect(getFrenchPublicLevelTone(FRENCH_PUBLIC_LIMIT_DB)).toBe('danger')
  })
})
