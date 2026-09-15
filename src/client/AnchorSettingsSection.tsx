/**
 * @yisiyun/dsh-anchor settings page — lives inside `settings.section`.
 *
 * Three zones:
 *  - the preset library, paged, with the exclusive 「不注入」 row pinned above it
 *    and one checkbox per preset (the opening prompt is a COMBINATION now);
 *  - the pager row, which also owns the add button;
 *  - the injection order: the selected presets, reorderable by drag or ↑/↓.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  MAX_REINJECT_TURN_INTERVAL,
  MAX_TEXT_LIMIT,
  MIN_TEXT_LIMIT,
  combinePromptTexts,
} from '../types/anchor-settings.ts'
import { dropTarget } from '../order.ts'
import type { AnchorSettingsController } from './settings-controller.ts'
import css from './AnchorSettingsSection.module.css'

/** Page sizes offered for the preset library. */
const PAGE_SIZES = [5, 10, 20] as const
const DEFAULT_PAGE_SIZE = 5

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
}

interface DragState {
  id: string
  over?: { id: string; half: 'before' | 'after' }
}

export function AnchorSettingsSection({ controller }: Props): React.ReactElement {
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

  return (
    <div className={css.section}>
      <div className={css.heading}>
        <div>
          <h2 className={css.title}>定锚 · 会话指令注入</h2>
          <p className={css.intro}>
            给每个新会话<strong>定锚</strong>：把勾选的预设按下面的顺序拼成一段指令注入；
            会话被压缩或过长后会<strong>重锚</strong>同一段原文。关闭总开关则暂停全部注入。
          </p>
        </div>
        <div className={css.headingActions}>
          <button
            type="button"
            className={css.secondaryButton}
            disabled={saving}
            onClick={() => {
              if (window.confirm('恢复为默认设置？当前预设、组合与重锚策略都会被覆盖。')) controller.resetToDefaults()
            }}
          >
            恢复默认
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
          <strong className={css.behaviorTitle}>启用注入</strong>
          <span className={css.behaviorDescription}>
            总开关：关闭后定锚与重锚全部停止，设置与组合保留。
          </span>
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
            <strong className={css.behaviorTitle}>压缩后自动重锚</strong>
            <span className={css.behaviorDescription}>
              会话被压缩（自动触发或 /compact）后，在下一次模型请求前把锚文原样重锚一次。
            </span>
          </span>
        </label>

        <div className={css.intervalRow}>
          <span className={css.behaviorCopy}>
            <strong className={css.behaviorTitle}>按轮数重锚</strong>
            <span className={css.behaviorDescription}>
              距上次定锚满 N 轮后，在下一轮开始时再重锚一次；填 0 关闭。
            </span>
          </span>
          <input
            type="number"
            className={css.numberInput}
            min={0}
            max={MAX_REINJECT_TURN_INTERVAL}
            step={1}
            value={settings.reinjectTurnInterval}
            aria-label="重锚轮数间隔"
            onChange={(event) => controller.setReinjectTurnInterval(Number(event.target.value))}
          />
        </div>

        <div className={css.intervalRow}>
          <span className={css.behaviorCopy}>
            <strong className={css.behaviorTitle}>重锚取哪一条</strong>
            <span className={css.behaviorDescription}>
              重锚重复哪一条：「定锚原文」= 会话开头那条，手发只算一次性；「最近一条」= 本插件最近一次注入，
              包含你用「📤 发组合」发出去的那条（等于在本会话把人设换掉）。
              {settings.manualSendDigests.length > 0
                ? ` 已记录 ${settings.manualSendDigests.length} 次手发组合。`
                : ' 还没记录过手发组合。'}
            </span>
          </span>
          <span className={css.tabs} role="group" aria-label="重锚来源">
            <button
              type="button"
              className={settings.reinjectSource === 'first' ? css.tabActive : css.tab}
              aria-pressed={settings.reinjectSource === 'first'}
              onClick={() => controller.setReinjectSource('first')}
            >
              定锚原文
            </button>
            <button
              type="button"
              className={settings.reinjectSource === 'latest' ? css.tabActive : css.tab}
              aria-pressed={settings.reinjectSource === 'latest'}
              onClick={() => controller.setReinjectSource('latest')}
            >
              最近一条
            </button>
          </span>
        </div>

        <div className={css.intervalRow}>
          <span className={css.behaviorCopy}>
            <strong className={css.behaviorTitle}>单条上限</strong>
            <span className={css.behaviorDescription}>
              编辑器里单条预设最多可输入的字数。已存在的长预设不会被自动截断。
            </span>
          </span>
          <input
            type="number"
            className={css.numberInput}
            min={MIN_TEXT_LIMIT}
            max={MAX_TEXT_LIMIT}
            step={100}
            value={settings.maxPromptChars}
            aria-label="单条上限字数"
            onChange={(event) => controller.setMaxPromptChars(Number(event.target.value))}
          />
        </div>

        <div className={css.intervalRow}>
          <span className={css.behaviorCopy}>
            <strong className={css.behaviorTitle}>合并上限</strong>
            <span className={css.behaviorDescription}>
              组合拼接后的总字数上限；超限则定锚与重锚都不注入，并写入日志。
            </span>
          </span>
          <input
            type="number"
            className={css.numberInput}
            min={MIN_TEXT_LIMIT}
            max={MAX_TEXT_LIMIT}
            step={100}
            value={settings.maxCombinedChars}
            aria-label="合并上限字数"
            onChange={(event) => controller.setMaxCombinedChars(Number(event.target.value))}
          />
        </div>

        <p className={css.hint}>
          重锚始终使用<strong>本次会话开始时那段原文</strong>（从会话记录里取回），
          不跟随下面的组合实时变化——改组合只影响下一个新会话。
        </p>
      </div>

      {status === 'loading' ? <p className={css.statusLine}>正在读取设置…</p> : null}
      {!writable && status !== 'loading' ? (
        <p className={css.notice}>设置存储不可写：本次修改只在当前页面内生效。</p>
      ) : null}
      {error !== undefined ? (
        <p className={css.error} role="alert">
          保存失败：{error}
        </p>
      ) : null}
      {saving ? (
        <p className={css.statusLine} role="status">
          正在保存…
        </p>
      ) : null}

      {adding ? (
        <div className={css.addPromptForm}>
          <input
            className={css.textInput}
            value={newName}
            autoFocus
            placeholder="预设名称，例如：中文简洁"
            aria-label="新预设名称"
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
            placeholder="注入给模型的提示词正文，例如：请用中文回答，所有代码先给最小可运行版本。"
            aria-label="新预设内容"
            onChange={(event) => setNewText(event.target.value)}
          />
          <div className={css.rowActions}>
            <span className={css.charCount}>
              {newText.length} / {settings.maxPromptChars} 字
            </span>
            <button type="button" className={css.primaryButton} onClick={saveAdd}>
              添加
            </button>
            <button type="button" className={css.secondaryButton} onClick={() => setAdding(false)}>
              取消
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
            aria-label="不注入任何内容"
            onChange={() => controller.clearSelection()}
          />
          <div className={css.promptMain}>
            <span className={css.promptName}>不注入</span>
            <p className={css.promptText}>
              新会话不定锚（已有会话的压缩/轮数重锚不受影响）。选它会清空下面的组合。
            </p>
          </div>
          {selectionEmpty ? <span className={css.badge}>已选</span> : null}
        </li>

        {prompts.length === 0 ? (
          <li>
            <p className={css.empty} style={{ margin: 0 }}>
              还没有预设。点击「＋ 新增预设」创建第一条。
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
                aria-label={`把预设「${prompt.name}」加入定锚组合`}
                onChange={() => controller.togglePrompt(prompt.id)}
              />
              {isEditing ? (
                <div className={css.promptEditor}>
                  <input
                    className={css.textInput}
                    value={editing.name}
                    autoFocus
                    aria-label="预设名称"
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
                    aria-label="预设内容"
                    onChange={(event) => setEditing({ ...editing, text: event.target.value })}
                  />
                  <div className={css.rowActions}>
                    <span className={css.charCount}>
                      {editing.text.length} / {settings.maxPromptChars} 字
                    </span>
                    <button type="button" className={css.primaryButton} onClick={saveEdit}>
                      保存
                    </button>
                    <button type="button" className={css.secondaryButton} onClick={() => setEditing(undefined)}>
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className={css.promptMain}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span className={css.promptName}>{prompt.name}</span>
                      {isSelected ? <span className={css.badge}>已加入组合</span> : null}
                      {overCap ? <span className={css.badgeMuted}>超出单条上限</span> : null}
                    </div>
                    <p
                      className={
                        prompt.text.trim() === ''
                          ? `${css.promptText} ${css.promptTextEmpty}`
                          : css.promptText
                      }
                    >
                      {prompt.text.trim() === '' ? '空内容（不会被注入）' : prompt.text}
                    </p>
                  </div>
                  <span className={css.rowActions}>
                    <button
                      type="button"
                      className={css.secondaryButton}
                      onClick={() => startEdit(prompt.id, prompt.name, prompt.text)}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      className={css.dangerButton}
                      onClick={() => {
                        if (window.confirm(`删除预设「${prompt.name}」？`)) controller.deletePrompt(prompt.id)
                      }}
                    >
                      删除
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
            ‹ 上一页
          </button>
          <span className={css.pagerStatus}>
            第 {currentPage} / {pageCount} 页 · 共 {prompts.length} 条
          </span>
          <button
            type="button"
            className={css.secondaryButton}
            disabled={currentPage >= pageCount}
            onClick={() => setPage(currentPage + 1)}
          >
            下一页 ›
          </button>
          <label className={css.pageSizeLabel}>
            每页
            <select
              className={css.pageSizeSelect}
              value={pageSize}
              aria-label="每页预设条数"
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
          ＋ 新增预设
        </button>
      </div>

      {/* Green zone: injection order of the selected presets. */}
      <div className={css.orderZone}>
        <div className={css.orderHead}>
          <strong className={css.orderTitle}>注入顺序</strong>
          <span className={css.orderHint}>拖拽或用 ↑ ↓ 调整；这里的顺序就是拼接顺序</span>
        </div>

        {selectedPrompts.length === 0 ? (
          <p className={css.orderEmpty}>
            还没选任何预设：勾选上方预设后，它们会按这里的顺序拼成锚文。当前状态为「不注入」，新会话不会收到定锚。
          </p>
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
                  <span className={css.orderPreview}>{firstLine(prompt.text) || '（空内容）'}</span>
                  <span className={css.rowActions}>
                    <button
                      type="button"
                      className={css.iconButton}
                      disabled={index === 0}
                      aria-label={`把「${prompt.name}」上移`}
                      onClick={() => controller.moveSelected(index, index - 1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className={css.iconButton}
                      disabled={index === selectedPrompts.length - 1}
                      aria-label={`把「${prompt.name}」下移`}
                      onClick={() => controller.moveSelected(index, index + 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className={css.iconButton}
                      aria-label={`把「${prompt.name}」移出组合`}
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
          合计 {combined.length} / {settings.maxCombinedChars} 字
          {overLimit ? ' —— 超限：不会注入，请精简组合或调高合并上限' : ''}
        </p>

        {combined !== '' ? (
          <details className={css.orderPreviewBox}>
            <summary className={css.orderPreviewSummary}>合并文本预览</summary>
            <pre className={css.orderPreviewBody}>{combined}</pre>
          </details>
        ) : null}
      </div>
    </div>
  )
}
