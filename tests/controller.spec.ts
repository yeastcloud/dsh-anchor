/**
 * Controller write discipline: every mutation must touch only the fields it
 * changed, keep the snapshot optimistic, and clamp what the UI can put in.
 */

import { describe, expect, it } from 'vitest'
import {
  AnchorSettingsController,
  type AnchorSettingsHost,
} from '../src/client/settings-controller.ts'
import {
  DEFAULT_ANCHOR_SETTINGS,
  FIELD_ANCHOR_SUBAGENTS,
  FIELD_ENABLED,
  FIELD_MAX_PROMPT_CHARS,
  FIELD_PROMPTS,
  FIELD_REINJECT_AFTER_COMPACTION,
  FIELD_REINJECT_SOURCE,
  FIELD_REINJECT_TOKEN_THRESHOLD,
  FIELD_REINJECT_TURN_INTERVAL,
  FIELD_SELECTED_IDS,
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
  // Exactly the shape both lines' transports expose: the 0.1.7 `ConfigForm`
  // snapshot carries the extra `base`/`user`/`revision`/`mode` fields, the
  // 0.1.6 scope does not — the controller reads neither.
  const host: AnchorSettingsHost<AnchorSettings> = {
    getSnapshot: () => ({ status: 'ready', value, writable: true }),
    subscribe: () => () => {},
    set: async (field: string, next: unknown) => {
      sets.push([field, next])
    },
    unset: async (field: string) => {
      unsets.push(field)
    },
  }

  const controller = new AnchorSettingsController(host)
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

  it('writes the token threshold alone, clamping what the field can hold', async () => {
    const harness = mount()
    harness.controller.setReinjectTokenThreshold(120_000)
    await harness.settle()
    expect(harness.sets).toEqual([[FIELD_REINJECT_TOKEN_THRESHOLD, 120_000]])

    harness.sets.length = 0
    harness.controller.setReinjectTokenThreshold(-1)
    await harness.settle()
    expect(harness.sets).toEqual([[FIELD_REINJECT_TOKEN_THRESHOLD, 0]])
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
        FIELD_REINJECT_AFTER_COMPACTION,
        FIELD_REINJECT_TURN_INTERVAL,
        FIELD_REINJECT_TOKEN_THRESHOLD,
        FIELD_ANCHOR_SUBAGENTS,
        FIELD_MAX_PROMPT_CHARS,
        'maxCombinedChars',
        FIELD_REINJECT_SOURCE,
      ]),
    )
  })
})
