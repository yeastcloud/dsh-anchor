/**
 * Client-side settings controller for @yeastcloud/dsh-anchor.
 *
 * Every mutation writes ONLY the fields it changed: with the ordered selection,
 * checkboxes and drag reordering touch `selectedIds` alone, so a rapid sequence
 * of edits cannot clobber an unrelated field the user just changed elsewhere.
 * The retired single-selection field is never written again.
 */

import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { translate, type AnchorCopyKey } from '../copy.ts'
import {
  DEFAULT_ANCHOR_SETTINGS,
  FIELD_ENABLED,
  FIELD_MAX_COMBINED_CHARS,
  FIELD_MAX_PROMPT_CHARS,
  FIELD_PROMPTS,
  FIELD_REINJECT_AFTER_COMPACTION,
  FIELD_REINJECT_SOURCE,
  FIELD_REINJECT_TURN_INTERVAL,
  FIELD_SELECTED_IDS,
  MAX_PROMPT_NAME_CHARS,
  cloneSettings,
  combinePromptTexts,
  normalizeReinjectSource,
  normalizeSelectedIds,
  normalizeTextLimit,
  normalizeTurnInterval,
  type AnchorPrompt,
  type AnchorSettings,
  type ReinjectSource,
} from '../types/anchor-settings.ts'
import { moveItem } from '../order.ts'

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`
}

/** One field to persist alongside the optimistic snapshot. */
type FieldWrite = readonly [field: string, value: unknown]

export interface AnchorSnapshot {
  status: 'loading' | 'ready' | 'unavailable'
  settings: AnchorSettings
  writable: boolean
  saving: boolean
  error?: string
  revision: number
}

export class AnchorSettingsController {
  private readonly host: SettingsScope<AnchorSettings>
  private readonly t: Translate<AnchorCopyKey>
  private readonly listeners = new Set<() => void>()
  private snapshot: AnchorSnapshot = {
    status: 'loading',
    settings: cloneSettings(DEFAULT_ANCHOR_SETTINGS),
    writable: false,
    saving: false,
    error: undefined,
    revision: 0,
  }

  /**
   * @param host - settings scope owning the durable document.
   * @param t - translator (this plugin's own copy keys) for the names the controller writes INTO that document; defaults to the Chinese dictionary, so a caller without a locale still stores a readable name.
   */
  constructor(
    host: SettingsScope<AnchorSettings>,
    t: Translate<AnchorCopyKey> = (key) => translate('zh', key),
  ) {
    this.host = host
    this.t = t
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): AnchorSnapshot => this.snapshot

  attach(): () => void {
    const dispose = this.host.subscribe(() => {
      this.adopt()
    })
    this.adopt()
    return dispose
  }

  setEnabled(enabled: boolean): void {
    this.commit(this.next({ enabled }), [[FIELD_ENABLED, enabled]])
  }

  setReinjectAfterCompaction(reinjectAfterCompaction: boolean): void {
    this.commit(this.next({ reinjectAfterCompaction }), [
      [FIELD_REINJECT_AFTER_COMPACTION, reinjectAfterCompaction],
    ])
  }

  setReinjectTurnInterval(reinjectTurnInterval: number): void {
    const value = normalizeTurnInterval(reinjectTurnInterval)
    this.commit(this.next({ reinjectTurnInterval: value }), [[FIELD_REINJECT_TURN_INTERVAL, value]])
  }

  setMaxPromptChars(maxPromptChars: number): void {
    const value = normalizeTextLimit(maxPromptChars, this.snapshot.settings.maxPromptChars)
    this.commit(this.next({ maxPromptChars: value }), [[FIELD_MAX_PROMPT_CHARS, value]])
  }

  setMaxCombinedChars(maxCombinedChars: number): void {
    const value = normalizeTextLimit(maxCombinedChars, this.snapshot.settings.maxCombinedChars)
    this.commit(this.next({ maxCombinedChars: value }), [[FIELD_MAX_COMBINED_CHARS, value]])
  }

  /** Choose which injection a re-injection repeats: the session's first or its latest. */
  setReinjectSource(reinjectSource: ReinjectSource): void {
    const value = normalizeReinjectSource(reinjectSource)
    this.commit(this.next({ reinjectSource: value }), [[FIELD_REINJECT_SOURCE, value]])
  }

  /** Add or remove one preset in the ordered combination. */
  togglePrompt(id: string): void {
    const { selectedIds, prompts } = this.snapshot.settings
    const next = selectedIds.includes(id)
      ? selectedIds.filter((candidate) => candidate !== id)
      : [...selectedIds, id]
    this.writeSelection(normalizeSelectedIds(next, prompts))
  }

  /** The exclusive 「不注入」 choice: an empty combination. */
  clearSelection(): void {
    this.writeSelection([])
  }

  removeSelected(id: string): void {
    const { selectedIds, prompts } = this.snapshot.settings
    this.writeSelection(normalizeSelectedIds(selectedIds.filter((candidate) => candidate !== id), prompts))
  }

  /** Reorder the combination; both drag-and-drop and the ↑/↓ buttons land here. */
  moveSelected(from: number, to: number): void {
    const { selectedIds, prompts } = this.snapshot.settings
    const moved = moveItem(selectedIds, from, to)
    if (moved.every((id, index) => id === selectedIds[index])) return
    this.writeSelection(normalizeSelectedIds(moved, prompts))
  }

  addPrompt(name: string, text: string): string {
    const current = this.snapshot.settings
    const prompt: AnchorPrompt = {
      id: newId('prompt'),
      name: name.trim() === '' ? this.t('unnamedPreset') : name.trim().slice(0, MAX_PROMPT_NAME_CHARS),
      text: text.slice(0, current.maxPromptChars),
    }
    const prompts = [...current.prompts, prompt]
    // First preset in an empty library becomes the selection: there was nothing
    // to select before, so this cannot overwrite a deliberate 「不注入」 choice.
    const selectedIds =
      current.selectedIds.length === 0 && current.prompts.length === 0 ? [prompt.id] : current.selectedIds
    this.commit(
      { ...current, prompts, selectedIds },
      [
        [FIELD_PROMPTS, prompts],
        [FIELD_SELECTED_IDS, selectedIds],
      ],
    )
    return prompt.id
  }

  updatePrompt(id: string, patch: Partial<Pick<AnchorPrompt, 'name' | 'text'>>): void {
    const current = this.snapshot.settings
    const prompts = current.prompts.map((prompt) =>
      prompt.id === id
        ? {
            ...prompt,
            name:
              patch.name !== undefined
                ? patch.name.trim() === ''
                  ? this.t('unnamedPreset')
                  : patch.name.trim().slice(0, MAX_PROMPT_NAME_CHARS)
                : prompt.name,
            text: patch.text !== undefined ? patch.text.slice(0, current.maxPromptChars) : prompt.text,
          }
        : prompt,
    )
    this.commit({ ...current, prompts }, [[FIELD_PROMPTS, prompts]])
  }

  deletePrompt(id: string): void {
    const current = this.snapshot.settings
    const prompts = current.prompts.filter((prompt) => prompt.id !== id)
    const selectedIds = normalizeSelectedIds(
      current.selectedIds.filter((candidate) => candidate !== id),
      prompts,
    )
    this.commit(
      { ...current, prompts, selectedIds },
      [
        [FIELD_PROMPTS, prompts],
        [FIELD_SELECTED_IDS, selectedIds],
      ],
    )
  }

  resetToDefaults(): void {
    const defaults = cloneSettings(DEFAULT_ANCHOR_SETTINGS)
    this.publish({ settings: defaults, saving: true, error: undefined })
    if (!this.snapshot.writable) {
      this.publish({ saving: false })
      return
    }
    Promise.all([
      this.host.unset(FIELD_ENABLED),
      this.host.unset(FIELD_SELECTED_IDS),
      this.host.unset(FIELD_PROMPTS),
      this.host.unset(FIELD_REINJECT_AFTER_COMPACTION),
      this.host.unset(FIELD_REINJECT_TURN_INTERVAL),
      this.host.unset(FIELD_MAX_PROMPT_CHARS),
      this.host.unset(FIELD_MAX_COMBINED_CHARS),
      this.host.unset(FIELD_REINJECT_SOURCE),
    ]).then(
      () => {
        this.publish({ saving: false, error: undefined })
      },
      (error: unknown) => {
        this.publish({ saving: false, error: describeError(error) })
      },
    )
  }

  /** Combined opening prompt of the current selection, in injection order. */
  combinedText(): string {
    const { prompts, selectedIds } = this.snapshot.settings
    return combinePromptTexts(prompts, selectedIds)
  }

  private writeSelection(selectedIds: readonly string[]): void {
    const current = this.snapshot.settings
    if (
      selectedIds.length === current.selectedIds.length
      && selectedIds.every((id, index) => id === current.selectedIds[index])
    ) {
      return
    }
    this.commit({ ...current, selectedIds: [...selectedIds] }, [[FIELD_SELECTED_IDS, [...selectedIds]]])
  }

  private next(patch: Partial<AnchorSettings>): AnchorSettings {
    return { ...this.snapshot.settings, ...patch }
  }

  private adopt(): void {
    const host = this.host.getSnapshot()
    const settings = host.value === undefined ? this.snapshot.settings : cloneSettings(host.value)
    this.publish({
      status: host.status,
      settings,
      writable: host.status === 'ready' && host.writable,
    })
  }

  private commit(next: AnchorSettings, writes: readonly FieldWrite[]): void {
    const settings = cloneSettings(next)
    this.publish({ settings, saving: true, error: undefined })
    if (!this.snapshot.writable) {
      this.publish({ saving: false })
      return
    }
    Promise.all(writes.map(([field, value]) => this.host.set(field, value))).then(
      () => {
        this.publish({ saving: false, error: undefined })
      },
      (error: unknown) => {
        this.publish({ saving: false, error: describeError(error) })
      },
    )
  }

  private publish(patch: Partial<AnchorSnapshot>): void {
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      revision: this.snapshot.revision + 1,
    } as AnchorSnapshot
    for (const listener of [...this.listeners]) listener()
  }
}
