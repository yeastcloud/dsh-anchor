/**
 * Controller write discipline: every mutation must touch only the fields it
 * changed, keep the snapshot optimistic, and clamp what the UI can put in.
 */

import { describe, expect, it } from 'vitest'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { AnchorSettingsController } from '../src/client/settings-controller.ts'
import { digestText } from '../src/digest.ts'
import {
  DEFAULT_ANCHOR_SETTINGS,
  FIELD_ENABLED,
  FIELD_MANUAL_SEND_DIGESTS,
  FIELD_MAX_PROMPT_CHARS,
  FIELD_PROMPTS,
  FIELD_REINJECT_SOURCE,
  FIELD_SELECTED_IDS,
  MAX_MANUAL_SEND_DIGESTS,
  MIN_TEXT_LIMIT,
  type AnchorSettings,
} from '../src/types/anchor-settings.ts'

const PROMPTS = [
  { id: 'a', name: 'A', text: '甲' },
  { id: 'b', name: 'B', text: '乙' },
]

interface Harness {
  controller: AnchorSettingsController
  sets: [string, unknown][]
  unsets: string[]
  settle: () => Promise<void>
}

function mount(initial: Partial<AnchorSettings> = {}): Harness {
  const value: AnchorSettings = { ...DEFAULT_ANCHOR_SETTINGS, selectedIds: ['a'], prompts: PROMPTS, ...initial }
  const sets: [string, unknown][] = []
  const unsets: string[] = []
  const scope = {
    getSnapshot: () => ({ status: 'ready', value, base: undefined, user: undefined, revision: 1, writable: true, mode: 'host' }),
    subscribe: () => () => {},
    set: async (field: string, next: unknown) => {
      sets.push([field, next])
    },
    unset: async (field: string) => {
      unsets.push(field)
    },
    mutate: async () => {},
  } as unknown as SettingsScope<AnchorSettings>

  const controller = new AnchorSettingsController(scope)
  controller.attach()
  return { controller, sets, unsets, settle: async () => { await new Promise((resolve) => setTimeout(resolve, 0)) } }
}

describe('AnchorSettingsController', () => {
  it('writes only the selection when a checkbox or a move changes it', async () => {
    const harness = mount()
    harness.controller.togglePrompt('b')
    await harness.settle()
    expect(harness.sets).toEqual([[FIELD_SELECTED_IDS, ['a', 'b']]])
    expect(harness.controller.getSnapshot().settings.selectedIds).toEqual(['a', 'b'])

    harness.sets.length = 0
    harness.controller.moveSelected(1, 0)
    await harness.settle()
    expect(harness.sets).toEqual([[FIELD_SELECTED_IDS, ['b', 'a']]])

    harness.sets.length = 0
    harness.controller.moveSelected(0, 0)
    await harness.settle()
    expect(harness.sets).toEqual([])

    harness.sets.length = 0
    harness.controller.togglePrompt('a')
    await harness.settle()
    expect(harness.sets).toEqual([[FIELD_SELECTED_IDS, ['b']]])
  })

  it('treats 「不注入」 as an empty selection', async () => {
    const harness = mount()
    harness.controller.clearSelection()
    await harness.settle()
    expect(harness.sets).toEqual([[FIELD_SELECTED_IDS, []]])
    expect(harness.controller.combinedText()).toBe('')
  })

  it('records a hand send once and keeps the newest digests first', async () => {
    const harness = mount()
    harness.controller.recordManualSend('手发的人设')
    await harness.settle()
    expect(harness.sets).toEqual([[FIELD_MANUAL_SEND_DIGESTS, [digestText('手发的人设')]]])

    harness.sets.length = 0
    harness.controller.recordManualSend('手发的人设')
    await harness.settle()
    expect(harness.sets).toEqual([])

    harness.controller.recordManualSend(' 手发的人设 ')
    await harness.settle()
    expect(harness.sets).toEqual([])

    const many = Array.from({ length: MAX_MANUAL_SEND_DIGESTS + 2 }, (_, index) => `组合${String(index)}`)
    for (const text of many) harness.controller.recordManualSend(text)
    await harness.settle()
    expect(harness.controller.getSnapshot().settings.manualSendDigests).toHaveLength(MAX_MANUAL_SEND_DIGESTS)
    expect(harness.controller.getSnapshot().settings.manualSendDigests[0]).toBe(digestText(many.at(-1) ?? ''))
  })

  it('ignores an empty hand send', async () => {
    const harness = mount()
    harness.controller.recordManualSend('   ')
    await harness.settle()
    expect(harness.sets).toEqual([])
  })

  it('writes the re-injection source and clamps text limits', async () => {
    const harness = mount()
    harness.controller.setReinjectSource('latest')
    await harness.settle()
    expect(harness.sets).toEqual([[FIELD_REINJECT_SOURCE, 'latest']])

    harness.sets.length = 0
    harness.controller.setMaxPromptChars(1)
    await harness.settle()
    expect(harness.sets).toEqual([[FIELD_MAX_PROMPT_CHARS, MIN_TEXT_LIMIT]])
  })

  it('prunes the selection when a preset is deleted', async () => {
    const harness = mount({ selectedIds: ['a', 'b'] })
    harness.controller.deletePrompt('a')
    await harness.settle()
    expect(harness.sets).toEqual([
      [FIELD_PROMPTS, [PROMPTS[1]]],
      [FIELD_SELECTED_IDS, ['b']],
    ])
  })

  it('selects the first preset of an empty library but leaves a deliberate one alone', async () => {
    const empty = mount({ selectedIds: [], prompts: [] })
    empty.controller.addPrompt('新预设', '正文')
    await empty.settle()
    const added = empty.controller.getSnapshot().settings
    expect(added.selectedIds).toHaveLength(1)

    const deliberate = mount({ selectedIds: [], prompts: PROMPTS })
    deliberate.controller.addPrompt('新预设', '正文')
    await deliberate.settle()
    expect(deliberate.controller.getSnapshot().settings.selectedIds).toEqual([])
  })

  it('clears every field on reset', async () => {
    const harness = mount()
    harness.controller.resetToDefaults()
    await harness.settle()
    expect(new Set(harness.unsets)).toEqual(
      new Set([
        FIELD_ENABLED,
        FIELD_SELECTED_IDS,
        FIELD_PROMPTS,
        'reinjectAfterCompaction',
        'reinjectTurnInterval',
        FIELD_MAX_PROMPT_CHARS,
        'maxCombinedChars',
        FIELD_REINJECT_SOURCE,
        FIELD_MANUAL_SEND_DIGESTS,
      ]),
    )
  })
})
