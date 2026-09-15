/**
 * Preset transfer documents: a legal library must survive a round trip, and every
 * malformed document must be refused with one named reason instead of a partial
 * library — an import that half-applies is worse than one that refuses.
 */

import { describe, expect, it } from 'vitest'
import {
  PRESET_DOCUMENT_FORMAT,
  PRESET_IMPORT_REASONS,
  parsePresetDocument,
  serializePresetDocument,
} from '../src/preset-transfer.ts'
import { MAX_PROMPT_NAME_CHARS, type AnchorPrompt } from '../src/types/anchor-settings.ts'

const PROMPTS: AnchorPrompt[] = [
  { id: 'a', name: '甲', text: '甲文' },
  { id: 'b', name: '乙', text: '乙文' },
]
const STAMP = '2026-09-15T00:00:00.000Z'

/** One document with a single field overridden. */
const documentWith = (patch: Record<string, unknown>): string =>
  JSON.stringify({
    format: PRESET_DOCUMENT_FORMAT,
    version: 1,
    exportedAt: STAMP,
    presets: PROMPTS,
    selectedIds: ['b'],
    ...patch,
  })

describe('preset transfer', () => {
  it('round-trips a library, its combination and its timestamp', () => {
    const text = serializePresetDocument({ prompts: PROMPTS, selectedIds: ['b'] }, STAMP)
    const parsed = parsePresetDocument(text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.presets).toEqual(PROMPTS)
    expect(parsed.selectedIds).toEqual(['b'])
    expect(parsed.exportedAt).toBe(STAMP)
  })

  it('refuses a malformed document with exactly one named reason', () => {
    const cases: [string, string][] = [
      ['', 'empty'],
      ['   \n', 'empty'],
      ['{oops', 'json'],
      [documentWith({ format: 'someone-elses.presets' }), 'format'],
      [documentWith({ version: 99 }), 'version'],
      [documentWith({ presets: 'nope' }), 'presets'],
      [documentWith({ presets: [{ id: '', name: '甲', text: '甲文' }] }), 'preset-id'],
      [documentWith({ presets: [{ id: 'a', name: '', text: '甲文' }] }), 'preset-name'],
      [documentWith({ presets: [{ id: 'a', name: '甲', text: 42 }] }), 'preset-text'],
      [
        documentWith({ presets: [{ id: 'a', name: 'x'.repeat(MAX_PROMPT_NAME_CHARS + 1), text: '甲文' }] }),
        'preset-name',
      ],
      [documentWith({ presets: [PROMPTS[0], PROMPTS[0]] }), 'duplicate-id'],
      [documentWith({ selectedIds: ['missing'] }), 'selection'],
    ]

    for (const [text, reason] of cases) {
      const parsed = parsePresetDocument(text)
      expect(parsed.ok, `${reason} must be refused`).toBe(false)
      if (!parsed.ok) expect(parsed.reason).toBe(reason)
    }
  })

  it('returns only reasons the module publishes', () => {
    for (const text of ['{oops', documentWith({ format: 'other' })]) {
      const parsed = parsePresetDocument(text)
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(PRESET_IMPORT_REASONS).toContain(parsed.reason)
    }
  })
})
