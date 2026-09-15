/**
 * @yisiyun/dsh-anchor composer dock button.
 *
 * Sits in `conversation.composer.dock` next to the ponytail pill: one click
 * sends the current combined opening prompt as a plain queued message
 * through the session input machine (`setDraft` + `submit`), never
 * interrupt-queueing. When injection is disabled, the combination is empty, or
 * the combined text exceeds its limit, it shows the framework toast instead of
 * sending.
 */

import { useCallback, useRef, useState } from 'react'
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { combinePromptTexts } from '../types/anchor-settings.ts'
import type { AnchorSnapshot } from './settings-controller.ts'
import type { AnchorSettingsController } from './settings-controller.ts'
import css from './SendPromptDock.module.css'

/**
 * Minimal structural face of the host-provided session input write path
 * (the full `InputActions` lives inside ui-conversation; structural typing
 * keeps this plugin decoupled from that package's internals).
 */
export interface SendPromptInput {
  /** Replace the composer draft with `text`. */
  setDraft(text: string): void
  /** Submit the current draft through the ordinary queue. */
  submit(): void
}

/**
 * Resolve the text that should be sent from the current settings snapshot.
 * @returns the trimmed combined text, or a failure reason when nothing may be sent.
 */
function resolvePrompt(snapshot: AnchorSnapshot): { ok: true; text: string } | { ok: false; reason: string } {
  const { enabled, prompts, selectedIds, maxCombinedChars } = snapshot.settings
  if (!enabled) {
    return { ok: false, reason: '定锚已关闭，未发送组合文本' }
  }
  const text = combinePromptTexts(prompts, selectedIds)
  if (text === '') {
    return { ok: false, reason: '当前组合为空（「不注入」）或内容为空，未发送组合文本' }
  }
  if (text.length > maxCombinedChars) {
    return {
      ok: false,
      reason: `合并后 ${text.length} 字，超过合并上限 ${maxCombinedChars} 字，未发送`,
    }
  }
  return { ok: true, text }
}

interface SendPromptDockProps {
  /** Session input write path supplied by the composer.dock owner. */
  inputActions: SendPromptInput
  /** Settings controller bound to the plugin namespace. */
  controller: AnchorSettingsController
}

interface ToastState {
  seq: number
  text: string
}

export function SendPromptDock({ inputActions, controller }: SendPromptDockProps) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const seqRef = useRef(0)

  const showToast = useCallback((text: string) => {
    seqRef.current += 1
    setToast({ seq: seqRef.current, text })
  }, [])

  const dismissToast = useCallback(() => {
    setToast(null)
  }, [])

  const sendPrompt = useCallback(() => {
    const picked = resolvePrompt(controller.getSnapshot())
    if (!picked.ok) {
      showToast(picked.reason)
      return
    }
    // Record before sending: the Host recognizes this message by content, so the
    // record has to be in place by the time it scans the log for it. With
    // 「最近一条」 selected, this send becomes the baseline a compaction repeats.
    controller.recordManualSend(picked.text)
    inputActions.setDraft(picked.text)
    inputActions.submit()
  }, [controller, inputActions, showToast])

  return (
    <div className={css.dock} data-dsh-anchor-send-dock="true">
      <button
        type="button"
        className={css.button}
        data-dsh-anchor-send="true"
        title="把当前组合的锚文作为普通消息发送"
        onClick={sendPrompt}
      >
        <span aria-hidden="true">📤</span>
        <span>发组合</span>
      </button>
      {toast !== null && (
        <Toast key={toast.seq} text={toast.text} onDone={dismissToast} />
      )}
    </div>
  )
}
