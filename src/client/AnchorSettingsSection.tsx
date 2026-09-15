/**
 * @yeastcloud/dsh-anchor settings page — lives inside `settings.section`.
 *
 * Three zones:
 *  - the preset library, paged, with the exclusive 「不注入」 row pinned above it
 *    and one checkbox per preset (the opening prompt is a COMBINATION now);
 *  - the pager row, which also owns the add button and the import/export pair
 *    that moves the whole library between machines;
 *  - the injection order: the selected presets, reorderable by drag or ↑/↓.
 *
 * Every visible string comes from the slot-injected `t` seat (namespace
 * `settings.anchor`), so the page follows the active DSH locale. Terms the copy
 * emphasizes keep their own keys (`introAnchor`, `hintFirst`, …) because each
 * renders inside its own emphasis element.
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  MAX_REINJECT_TOKEN_THRESHOLD,
  MAX_REINJECT_TURN_INTERVAL,
  MAX_TEXT_LIMIT,
  MIN_TEXT_LIMIT,
  combinePromptTexts,
} from '../types/anchor-settings.ts'
import { dropTarget } from '../order.ts'
import { serializePresetDocument } from '../preset-transfer.ts'
import type { AnchorSettingsController } from './settings-controller.ts'
import css from './AnchorSettingsSection.module.css'

/** Page sizes offered for the preset library. */
const PAGE_SIZES = [5, 10, 20] as const
const DEFAULT_PAGE_SIZE = 5

/** File name of one exported library. */
const PRESET_FILE_NAME = 'dsh-anchor-presets.json'

/**
 * Accept the native drag at document level while a row drag is active: row hover
 * still owns the insertion marker, and releasing outside the list must not be
 * rendered as a rejected drop before dragend commits that last marker.
 */
function useNativeDragAcceptance(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const acceptDrag = (event: DragEvent): void => {
      event.preventDefault()
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move'
    }
    const acceptDrop = (event: DragEvent): void => {
      event.preventDefault()
    }
    document.addEventListener('dragover', acceptDrag)
    document.addEventListener('drop', acceptDrop)
    return () => {
      document.removeEventListener('dragover', acceptDrag)
      document.removeEventListener('drop', acceptDrop)
    }
  }, [active])
}

/** Which half of a row the pointer is over (insertion marker above or below). */
function rowHalf(event: React.DragEvent<HTMLElement>): 'before' | 'after' {
  const rect = event.currentTarget.getBoundingClientRect()
  return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

/** One-line preview of a preset body. */
function firstLine(text: string): string {
  const line = (text.trim().split('\n')[0] ?? '').trim()
  return line.length > 56 ? `${line.slice(0, 56)}…` : line
}

interface Props {
  controller: AnchorSettingsController
  t: TranslateNS<'settings.anchor'>
}

interface DragState {
  id: string
  over?: { id: string; half: 'before' | 'after' }
}

export function AnchorSettingsSection({ controller, t }: Props): React.ReactElement {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const { settings, status, writable, saving, error } = snapshot

  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newText, setNewText] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string; text: string } | undefined>(undefined)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)
  const [drag, setDrag] = useState<DragState | null>(null)
  const dropCommitted = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useNativeDragAcceptance(drag !== null)

  const { prompts, selectedIds } = settings
  const selectionEmpty = selectedIds.length === 0
  const selectedSet = new Set(selectedIds)
  const combined = combinePromptTexts(prompts, selectedIds)
  const overLimit = combined.length > settings.maxCombinedChars

  const pageCount = Math.max(1, Math.ceil(prompts.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const pagePrompts = prompts.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const selectedPrompts = selectedIds
    .map((id) => prompts.find((prompt) => prompt.id === id))
    .filter((prompt): prompt is NonNullable<typeof prompt> => prompt !== undefined)

  const startEdit = (id: string, name: string, text: string): void => {
    setAdding(false)
    setEditing({ id, name, text })
  }

  const saveEdit = (): void => {
    if (editing === undefined) return
    controller.updatePrompt(editing.id, { name: editing.name, text: editing.text })
    setEditing(undefined)
  }

  const saveAdd = (): void => {
    controller.addPrompt(newName, newText)
    setAdding(false)
    setNewName('')
    setNewText('')
  }

  const commitDrag = (activeId: string, over: DragState['over']): void => {
    if (dropCommitted.current) return
    dropCommitted.current = true
    setDrag(null)
    if (over === undefined || over.id === activeId) return
    const from = selectedIds.indexOf(activeId)
    const to = selectedIds.indexOf(over.id)
    if (from === -1 || to === -1) return
    controller.moveSelected(from, dropTarget(from, to, over.half))
  }

  /** Download the whole library as the document the import control reads back. */
  const exportLibrary = (): void => {
    const text = serializePresetDocument({ prompts, selectedIds }, new Date().toISOString())
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const link = window.document.createElement('a')
    link.href = url
    link.download = PRESET_FILE_NAME
    link.click()
    // The browser reads the blob after click(); revoking on the next tick frees
    // the URL without cutting the download short.
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  /** Hand one chosen file to the controller, which validates it before writing anything. */
  const importLibrary = async (file: File): Promise<void> => {
    controller.importPresets(await file.text(), (question) => window.confirm(question))
  }

  return (
    <div className={css.section}>
      <div className={css.heading}>
        <div>
          <h2 className={css.title}>{t('title')}</h2>
          <p className={css.intro}>
            {t('introLead')}<strong>{t('introAnchor')}</strong>{t('introMid')}
            <strong>{t('introReanchor')}</strong>{t('introTail')}
          </p>
        </div>
        <div className={css.headingActions}>
          <button
            type="button"
            className={css.secondaryButton}
            disabled={saving}
            onClick={() => {
              if (window.confirm(t('resetConfirm'))) controller.resetToDefaults()
            }}
          >
            {t('reset')}
          </button>
        </div>
      </div>

      <label className={css.behaviorSwitch}>
        <input
          type="checkbox"
          className={css.behaviorCheckbox}
          checked={settings.enabled}
          onChange={(event) => controller.setEnabled(event.target.checked)}
        />
        <span className={css.behaviorCopy}>
          <strong className={css.behaviorTitle}>{t('enabledTitle')}</strong>
          <span className={css.behaviorDescription}>{t('enabledDescription')}</span>
        </span>
      </label>

      <label className={css.behaviorSwitch}>
        <input
          type="checkbox"
          className={css.behaviorCheckbox}
          checked={settings.anchorSubagents}
          onChange={(event) => controller.setAnchorSubagents(event.target.checked)}
        />
        <span className={css.behaviorCopy}>
          <strong className={css.behaviorTitle}>{t('subagentTitle')}</strong>
          <span className={css.behaviorDescription}>{t('subagentDescription')}</span>
        </span>
      </label>

      <div className={css.reinjectBlock}>
        <label className={css.behaviorSwitch}>
          <input
            type="checkbox"
            className={css.behaviorCheckbox}
            checked={settings.reinjectAfterCompaction}
            onChange={(event) => controller.setReinjectAfterCompaction(event.target.checked)}
          />
          <span className={css.behaviorCopy}>
            <strong className={css.behaviorTitle}>{t('reinjectTitle')}</strong>
            <span className={css.behaviorDescription}>{t('reinjectDescription')}</span>
          </span>
        </label>

        <div className={css.intervalRow}>
          <span className={css.behaviorCopy}>
            <strong className={css.behaviorTitle}>{t('turnIntervalTitle')}</strong>
            <span className={css.behaviorDescription}>{t('turnIntervalDescription')}</span>
          </span>
          <input
            type="number"
            className={css.numberInput}
            min={0}
            max={MAX_REINJECT_TURN_INTERVAL}
            step={1}
            value={settings.reinjectTurnInterval}
            aria-label={t('turnIntervalAria')}
            onChange={(event) => controller.setReinjectTurnInterval(Number(event.target.value))}
          />
        </div>

        <div className={css.intervalRow}>
          <span className={css.behaviorCopy}>
            <strong className={css.behaviorTitle}>{t('tokenThresholdTitle')}</strong>
            <span className={css.behaviorDescription}>{t('tokenThresholdDescription')}</span>
          </span>
          <input
            type="number"
            className={css.numberInput}
            min={0}
            max={MAX_REINJECT_TOKEN_THRESHOLD}
            step={1000}
            value={settings.reinjectTokenThreshold}
            aria-label={t('tokenThresholdAria')}
            onChange={(event) => controller.setReinjectTokenThreshold(Number(event.target.value))}
          />
        </div>

        <div className={css.intervalRow}>
          <span className={css.behaviorCopy}>
            <strong className={css.behaviorTitle}>{t('reinjectSourceTitle')}</strong>
            <span className={css.behaviorDescription}>{t('reinjectSourceDescription')}</span>
          </span>
          <span className={css.tabs} role="group" aria-label={t('reinjectSourceAria')}>
            <button
              type="button"
              className={settings.reinjectSource === 'first' ? css.tabActive : css.tab}
              aria-pressed={settings.reinjectSource === 'first'}
              onClick={() => controller.setReinjectSource('first')}
            >
              {t('reinjectFirst')}
            </button>
            <button
              type="button"
              className={settings.reinjectSource === 'latest' ? css.tabActive : css.tab}
              aria-pressed={settings.reinjectSource === 'latest'}
              onClick={() => controller.setReinjectSource('latest')}
            >
              {t('reinjectLatest')}
            </button>
            <button
              type="button"
              className={settings.reinjectSource === 'refresh' ? css.tabActive : css.tab}
              aria-pressed={settings.reinjectSource === 'refresh'}
              onClick={() => controller.setReinjectSource('refresh')}
            >
              {t('reinjectRefresh')}
            </button>
          </span>
        </div>

        <div className={css.intervalRow}>
          <span className={css.behaviorCopy}>
            <strong className={css.behaviorTitle}>{t('maxPromptTitle')}</strong>
            <span className={css.behaviorDescription}>{t('maxPromptDescription')}</span>
          </span>
          <input
            type="number"
            className={css.numberInput}
            min={MIN_TEXT_LIMIT}
            max={MAX_TEXT_LIMIT}
            step={100}
            value={settings.maxPromptChars}
            aria-label={t('maxPromptAria')}
            onChange={(event) => controller.setMaxPromptChars(Number(event.target.value))}
          />
        </div>

        <div className={css.intervalRow}>
          <span className={css.behaviorCopy}>
            <strong className={css.behaviorTitle}>{t('maxCombinedTitle')}</strong>
            <span className={css.behaviorDescription}>{t('maxCombinedDescription')}</span>
          </span>
          <input
            type="number"
            className={css.numberInput}
            min={MIN_TEXT_LIMIT}
            max={MAX_TEXT_LIMIT}
            step={100}
            value={settings.maxCombinedChars}
            aria-label={t('maxCombinedAria')}
            onChange={(event) => controller.setMaxCombinedChars(Number(event.target.value))}
          />
        </div>

        <p className={css.hint}>
          {t('hintLead')}<strong>{t('hintFirst')}</strong>{t('hintMid')}
          <strong>{t('hintLatest')}</strong>{t('hintMid2')}
          <strong>{t('hintRefresh')}</strong>{t('hintTail')}
        </p>
      </div>

      {status === 'loading' ? <p className={css.statusLine}>{t('loading')}</p> : null}
      {!writable && status !== 'loading' ? <p className={css.notice}>{t('readOnly')}</p> : null}
      {error !== undefined ? (
        <p className={css.error} role="alert">
          {error}
        </p>
      ) : null}
      {saving ? (
        <p className={css.statusLine} role="status">
          {t('saving')}
        </p>
      ) : null}

      {adding ? (
        <div className={css.addPromptForm}>
          <input
            className={css.textInput}
            value={newName}
            autoFocus
            placeholder={t('newNamePlaceholder')}
            aria-label={t('newNameAria')}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setAdding(false)
            }}
          />
          <textarea
            className={css.textarea}
            value={newText}
            rows={3}
            maxLength={settings.maxPromptChars}
            placeholder={t('newTextPlaceholder')}
            aria-label={t('newTextAria')}
            onChange={(event) => setNewText(event.target.value)}
          />
          <div className={css.rowActions}>
            <span className={css.charCount}>
              {t('charCount', { used: newText.length, max: settings.maxPromptChars })}
            </span>
            <button type="button" className={css.primaryButton} onClick={saveAdd}>
              {t('add')}
            </button>
            <button type="button" className={css.secondaryButton} onClick={() => setAdding(false)}>
              {t('cancel')}
            </button>
          </div>
        </div>
      ) : null}

      {/* Red zone: the preset library (paged) under the exclusive 「不注入」 row. */}
      <ul className={css.prompts}>
        <li className={`${css.promptRow} ${selectionEmpty ? css.promptRowSelected : ''}`}>
          <input
            type="checkbox"
            className={css.checkbox}
            checked={selectionEmpty}
            aria-label={t('noneAria')}
            onChange={() => controller.clearSelection()}
          />
          <div className={css.promptMain}>
            <span className={css.promptName}>{t('noneName')}</span>
            <p className={css.promptText}>{t('noneDescription')}</p>
          </div>
          {selectionEmpty ? <span className={css.badge}>{t('selected')}</span> : null}
        </li>

        {prompts.length === 0 ? (
          <li>
            <p className={css.empty} style={{ margin: 0 }}>
              {t('emptyLibrary')}
            </p>
          </li>
        ) : null}

        {pagePrompts.map((prompt) => {
          const isSelected = selectedSet.has(prompt.id)
          const isEditing = editing?.id === prompt.id
          const overCap = prompt.text.length > settings.maxPromptChars
          return (
            <li key={prompt.id} className={`${css.promptRow} ${isSelected ? css.promptRowSelected : ''}`}>
              <input
                type="checkbox"
                className={css.checkbox}
                checked={isSelected}
                aria-label={t('joinAria', { name: prompt.name })}
                onChange={() => controller.togglePrompt(prompt.id)}
              />
              {isEditing ? (
                <div className={css.promptEditor}>
                  <input
                    className={css.textInput}
                    value={editing.name}
                    autoFocus
                    aria-label={t('editNameAria')}
                    onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') saveEdit()
                      if (event.key === 'Escape') setEditing(undefined)
                    }}
                  />
                  <textarea
                    className={css.textarea}
                    value={editing.text}
                    rows={3}
                    maxLength={settings.maxPromptChars}
                    aria-label={t('editTextAria')}
                    onChange={(event) => setEditing({ ...editing, text: event.target.value })}
                  />
                  <div className={css.rowActions}>
                    <span className={css.charCount}>
                      {t('charCount', { used: editing.text.length, max: settings.maxPromptChars })}
                    </span>
                    <button type="button" className={css.primaryButton} onClick={saveEdit}>
                      {t('save')}
                    </button>
                    <button type="button" className={css.secondaryButton} onClick={() => setEditing(undefined)}>
                      {t('cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className={css.promptMain}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span className={css.promptName}>{prompt.name}</span>
                      {isSelected ? <span className={css.badge}>{t('inCombination')}</span> : null}
                      {overCap ? <span className={css.badgeMuted}>{t('overCap')}</span> : null}
                    </div>
                    <p
                      className={
                        prompt.text.trim() === ''
                          ? `${css.promptText} ${css.promptTextEmpty}`
                          : css.promptText
                      }
                    >
                      {prompt.text.trim() === '' ? t('emptyText') : prompt.text}
                    </p>
                  </div>
                  <span className={css.rowActions}>
                    <button
                      type="button"
                      className={css.secondaryButton}
                      onClick={() => startEdit(prompt.id, prompt.name, prompt.text)}
                    >
                      {t('edit')}
                    </button>
                    <button
                      type="button"
                      className={css.dangerButton}
                      onClick={() => {
                        if (window.confirm(t('deleteConfirm', { name: prompt.name }))) {
                          controller.deletePrompt(prompt.id)
                        }
                      }}
                    >
                      {t('delete')}
                    </button>
                  </span>
                </>
              )}
            </li>
          )
        })}
      </ul>

      {/* Yellow zone: pager + add. */}
      <div className={css.pager}>
        <div className={css.pagerControls}>
          <button
            type="button"
            className={css.secondaryButton}
            disabled={currentPage <= 1}
            onClick={() => setPage(currentPage - 1)}
          >
            {t('previousPage')}
          </button>
          <span className={css.pagerStatus}>
            {t('pageStatus', { page: currentPage, pages: pageCount, total: prompts.length })}
          </span>
          <button
            type="button"
            className={css.secondaryButton}
            disabled={currentPage >= pageCount}
            onClick={() => setPage(currentPage + 1)}
          >
            {t('nextPage')}
          </button>
          <label className={css.pageSizeLabel}>
            {t('pageSizeLabel')}
            <select
              className={css.pageSizeSelect}
              value={pageSize}
              aria-label={t('pageSizeAria')}
              onChange={(event) => {
                setPageSize(Number(event.target.value))
                setPage(1)
              }}
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        </div>
        <span className={css.pagerActions}>
          <button type="button" className={css.secondaryButton} onClick={exportLibrary}>
            {t('exportPresets')}
          </button>
          <button
            type="button"
            className={css.secondaryButton}
            onClick={() => fileInput.current?.click()}
          >
            {t('importPresets')}
          </button>
          <input
            ref={fileInput}
            type="file"
            className={css.fileInput}
            accept=".json,application/json"
            aria-label={t('importFileAria')}
            onChange={(event) => {
              const file = event.target.files?.[0]
              // Reset first, so choosing the same file again fires another change.
              event.target.value = ''
              if (file !== undefined) void importLibrary(file)
            }}
          />
          <button
            type="button"
            className={css.addPromptButton}
            onClick={() => {
              setEditing(undefined)
              setAdding(true)
              setNewName('')
              setNewText('')
            }}
          >
            {t('addPreset')}
          </button>
        </span>
      </div>

      {/* Green zone: injection order of the selected presets. */}
      <div className={css.orderZone}>
        <div className={css.orderHead}>
          <strong className={css.orderTitle}>{t('orderTitle')}</strong>
          <span className={css.orderHint}>{t('orderHint')}</span>
        </div>

        {selectedPrompts.length === 0 ? (
          <p className={css.orderEmpty}>{t('orderEmpty')}</p>
        ) : (
          <ol className={css.orderList}>
            {selectedPrompts.map((prompt, index) => {
              const over = drag?.over?.id === prompt.id ? drag.over.half : undefined
              const { id } = prompt
              return (
                <li
                  key={id}
                  className={`${css.orderRow} ${over === 'before' ? css.dropBefore : ''} ${
                    over === 'after' ? css.dropAfter : ''
                  }`}
                  draggable
                  onDragStart={(event) => {
                    dropCommitted.current = false
                    setDrag({ id })
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', id)
                  }}
                  onDragOver={(event) => {
                    if (drag === null || drag.id === id) return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                    setDrag({ id: drag.id, over: { id, half: rowHalf(event) } })
                  }}
                  onDragLeave={() => {
                    if (drag?.over?.id === id) setDrag({ id: drag.id })
                  }}
                  onDrop={(event) => {
                    if (drag === null) return
                    event.preventDefault()
                    commitDrag(drag.id, { id, half: rowHalf(event) })
                  }}
                  onDragEnd={() => {
                    if (drag === null) return
                    if (drag.over !== undefined) commitDrag(drag.id, drag.over)
                    else setDrag(null)
                  }}
                >
                  <span className={css.dragHandle} aria-hidden="true">
                    ⠿
                  </span>
                  <span className={css.orderIndex}>{index + 1}</span>
                  <span className={css.orderName}>{prompt.name}</span>
                  <span className={css.orderPreview}>{firstLine(prompt.text) || t('orderEmptyPreview')}</span>
                  <span className={css.rowActions}>
                    <button
                      type="button"
                      className={css.iconButton}
                      disabled={index === 0}
                      aria-label={t('moveUpAria', { name: prompt.name })}
                      onClick={() => controller.moveSelected(index, index - 1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className={css.iconButton}
                      disabled={index === selectedPrompts.length - 1}
                      aria-label={t('moveDownAria', { name: prompt.name })}
                      onClick={() => controller.moveSelected(index, index + 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className={css.iconButton}
                      aria-label={t('removeAria', { name: prompt.name })}
                      onClick={() => controller.removeSelected(id)}
                    >
                      ×
                    </button>
                  </span>
                </li>
              )
            })}
          </ol>
        )}

        <p className={overLimit ? css.orderOverLimit : css.orderMeta} role={overLimit ? 'alert' : undefined}>
          {t('totalChars', { used: combined.length, max: settings.maxCombinedChars })}
          {overLimit ? t('overLimitSuffix') : ''}
        </p>

        {combined !== '' ? (
          <details className={css.orderPreviewBox}>
            <summary className={css.orderPreviewSummary}>{t('previewSummary')}</summary>
            <pre className={css.orderPreviewBody}>{combined}</pre>
          </details>
        ) : null}
      </div>
    </div>
  )
}
