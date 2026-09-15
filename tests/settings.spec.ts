/**
 * Durable-settings decoding: the client bundle is served over HTTP while the
 * host half only reloads when the profile restarts, so a refreshed page can
 * meet the previous host half — and a settings document can predate the
 * combination model. Decoding must survive both without blanking the page or
 * silently changing which opening prompt a session would get.
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ANCHOR_SETTINGS,
  DEFAULT_MAX_COMBINED_CHARS,
  DEFAULT_MAX_PROMPT_CHARS,
  DEFAULT_REINJECT_SOURCE,
  DEFAULT_REINJECT_TURN_INTERVAL,
  MAX_PROMPTS,
  MAX_SELECTED_IDS,
  MAX_TEXT_LIMIT,
  MIN_TEXT_LIMIT,
  normalizeReinjectSource,
  normalizeTextLimit,
  normalizeTurnInterval,
  parseAnchorSettings,
} from '../src/types/anchor-settings.ts'

const prompt = (id: string, text = '锚文') => ({ id, name: id.toUpperCase(), text })

describe('parseAnchorSettings', () => {
  it('migrates the retired single selection into the ordered combination', () => {
    const parsed = parseAnchorSettings({ enabled: true, selectedId: 'whale', prompts: [prompt('whale')] })
    expect(parsed?.selectedIds).toEqual(['whale'])
  })

  it('reads a retired empty selection as 「不注入」, not as "unconfigured"', () => {
    const parsed = parseAnchorSettings({ enabled: true, selectedId: '', prompts: [prompt('a')] })
    expect(parsed?.selectedIds).toEqual([])
  })

  it('defaults an unconfigured selection and keeps an explicit empty combination empty', () => {
    const fresh = parseAnchorSettings({ enabled: true, prompts: [{ id: 'default', name: 'D', text: 'x' }] })
    expect(fresh?.selectedIds).toEqual(['default'])

    const explicit = parseAnchorSettings({ enabled: true, selectedIds: [], prompts: [prompt('a')] })
    expect(explicit?.selectedIds).toEqual([])
  })

  it('keeps combination order, drops duplicates and dangling ids, and caps the length', () => {
    const parsed = parseAnchorSettings({
      enabled: true,
      selectedIds: ['b', 'a', 'b', 'gone'],
      prompts: [prompt('a'), prompt('b')],
    })
    expect(parsed?.selectedIds).toEqual(['b', 'a'])

    const many = Array.from({ length: MAX_SELECTED_IDS + 3 }, (_, index) => prompt(`p${String(index)}`))
    const capped = parseAnchorSettings({ enabled: true, selectedIds: many.map((item) => item.id), prompts: many })
    expect(capped?.selectedIds).toHaveLength(MAX_SELECTED_IDS)
  })

  it('accepts a payload from a host half that predates the new fields', () => {
    const parsed = parseAnchorSettings({ enabled: true, selectedId: 'a', prompts: [prompt('a')] })
    expect(parsed?.reinjectAfterCompaction).toBe(DEFAULT_ANCHOR_SETTINGS.reinjectAfterCompaction)
    expect(parsed?.reinjectTurnInterval).toBe(DEFAULT_REINJECT_TURN_INTERVAL)
    expect(parsed?.maxPromptChars).toBe(DEFAULT_MAX_PROMPT_CHARS)
    expect(parsed?.maxCombinedChars).toBe(DEFAULT_MAX_COMBINED_CHARS)
  })

  it('keeps explicit limit values, clamps out-of-range ones, and defaults garbage', () => {
    const explicit = parseAnchorSettings({
      enabled: true,
      selectedIds: [],
      prompts: [prompt('a')],
      maxPromptChars: 200,
      maxCombinedChars: 60000,
    })
    expect(explicit?.maxPromptChars).toBe(200)
    expect(explicit?.maxCombinedChars).toBe(60000)

    const clamped = parseAnchorSettings({
      enabled: true,
      selectedIds: [],
      prompts: [prompt('a')],
      maxPromptChars: 1,
      maxCombinedChars: 1e9,
    })
    expect(clamped?.maxPromptChars).toBe(MIN_TEXT_LIMIT)
    expect(clamped?.maxCombinedChars).toBe(MAX_TEXT_LIMIT)

    const broken = parseAnchorSettings({
      enabled: true,
      selectedIds: [],
      prompts: [prompt('a')],
      maxPromptChars: 'many',
    })
    expect(broken?.maxPromptChars).toBe(DEFAULT_MAX_PROMPT_CHARS)
  })

  it('no longer caps a single preset body (the configured limit owns that)', () => {
    const long = '字'.repeat(20000)
    const parsed = parseAnchorSettings({ enabled: true, selectedIds: [], prompts: [prompt('a', long)] })
    expect(parsed?.prompts[0]?.text).toHaveLength(20000)
  })

  it('still rejects a structurally invalid payload', () => {
    expect(parseAnchorSettings(null)).toBeUndefined()
    expect(parseAnchorSettings({ enabled: 'yes', prompts: [] })).toBeUndefined()
    expect(parseAnchorSettings({ enabled: true, prompts: 'nope' })).toBeUndefined()
    expect(parseAnchorSettings({ enabled: true, prompts: [{ id: 'a', name: 'A' }] })).toBeUndefined()
    expect(parseAnchorSettings({ enabled: true, prompts: [{ id: 'a', name: 'x'.repeat(300), text: '' }] })).toBeUndefined()
    const tooMany = Array.from({ length: MAX_PROMPTS + 1 }, (_, index) => prompt(`p${String(index)}`))
    expect(parseAnchorSettings({ enabled: true, selectedIds: [], prompts: tooMany })).toBeUndefined()
  })
})

describe('limit normalizers', () => {
  it('clamps turn intervals', () => {
    expect(normalizeTurnInterval(-5)).toBe(0)
    expect(normalizeTurnInterval(3.9)).toBe(3)
    expect(normalizeTurnInterval(Number.NaN)).toBe(DEFAULT_REINJECT_TURN_INTERVAL)
  })

  it('clamps character limits into the accepted range', () => {
    expect(normalizeTextLimit(50, DEFAULT_MAX_PROMPT_CHARS)).toBe(MIN_TEXT_LIMIT)
    expect(normalizeTextLimit(500.7, DEFAULT_MAX_PROMPT_CHARS)).toBe(500)
    expect(normalizeTextLimit(1e9, DEFAULT_MAX_PROMPT_CHARS)).toBe(MAX_TEXT_LIMIT)
    expect(normalizeTextLimit(Number.NaN, DEFAULT_MAX_PROMPT_CHARS)).toBe(DEFAULT_MAX_PROMPT_CHARS)
  })
})

describe('re-injection source and hand-send digests', () => {
  it('narrows the source, defaulting anything unrecognized', () => {
    expect(normalizeReinjectSource('latest')).toBe('latest')
    expect(normalizeReinjectSource('first')).toBe('first')
    expect(normalizeReinjectSource('sometimes')).toBe(DEFAULT_REINJECT_SOURCE)
    expect(normalizeReinjectSource(undefined)).toBe(DEFAULT_REINJECT_SOURCE)
  })

  it('decodes the stored re-injection source', () => {
    const parsed = parseAnchorSettings({
      enabled: true,
      selectedIds: [],
      prompts: [prompt('a')],
      reinjectSource: 'latest',
    })
    expect(parsed?.reinjectSource).toBe('latest')
  })

  it('defaults the source when a host half predates it', () => {
    const parsed = parseAnchorSettings({ enabled: true, selectedIds: [], prompts: [prompt('a')] })
    expect(parsed?.reinjectSource).toBe(DEFAULT_REINJECT_SOURCE)
  })
})
