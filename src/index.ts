/**
 * @yeastcloud/dsh-anchor — Host half.
 *
 * Durable settings namespace + opening-prompt injection.
 *
 * Injection happens at two moments, both through the same `agent/pre-step`
 * waterfall and both carrying the identical plugin-sourced user message:
 *  - session start: the combined text of the ordered selection, once, on the
 *    very first step of the session's OWN first turn (`turn === 1`);
 *  - re-injection: a baseline already in the durable log, when the session
 *    either completed a summarizing compaction or opened
 *    `reinjectTurnInterval` turns since the last injection.
 *
 * Which baseline a re-injection repeats is the user's choice
 * (`reinjectSource`): the session's FIRST injection (the opening prompt, so a
 * hand-sent combination stays a one-off) or the LATEST one (which makes a
 * hand-sent combination a deliberate switch for the rest of the session). The
 * text always comes from the durable log, never from the settings selection, so
 * editing the combination mid-session cannot restate a different prompt into a
 * running conversation.
 *
 * A session that never received an opening prompt never gets one later — no
 * injection is invented mid-conversation, and no re-injection is possible
 * without a baseline to repeat.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-agent'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import z from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import {
  DEFAULT_ANCHOR_SETTINGS,
  DEFAULT_MAX_COMBINED_CHARS,
  DEFAULT_MAX_PROMPT_CHARS,
  DEFAULT_REINJECT_SOURCE,
  DEFAULT_REINJECT_TURN_INTERVAL,
  FIELD_ENABLED,
  FIELD_MANUAL_SEND_DIGESTS,
  FIELD_MAX_COMBINED_CHARS,
  FIELD_MAX_PROMPT_CHARS,
  FIELD_PROMPTS,
  FIELD_REINJECT_AFTER_COMPACTION,
  FIELD_REINJECT_SOURCE,
  FIELD_REINJECT_TURN_INTERVAL,
  FIELD_SELECTED_IDS,
  MAX_MANUAL_SEND_DIGESTS,
  MAX_PROMPTS,
  MAX_PROMPT_NAME_CHARS,
  MAX_REINJECT_TURN_INTERVAL,
  MAX_SELECTED_IDS,
  MAX_TEXT_LIMIT,
  MIN_TEXT_LIMIT,
  NS,
  combinePromptTexts,
  normalizeManualSendDigests,
  type AnchorSettings,
} from './types/anchor-settings.ts'
import { readInjectionHistory, reinjectionReason } from './trigger.ts'

export const name = NS

/** 本插件必备宿主服务：settings（设置命名空间，Cordis 4 起直读 ctx.settings 必须显式声明）。 */
export const inject: string[] = ['settings']

const AnchorPromptSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(MAX_PROMPT_NAME_CHARS),
  // No length cap here on purpose: the authoring limit is the user-configured
  // `maxPromptChars` field, and a stored prompt is never truncated behind the
  // user's back. The injection gate (`maxCombinedChars`) bounds what a session
  // can actually receive.
  text: z.string(),
})

const AnchorSettingsSchema = z.object({
  [FIELD_ENABLED]: z.boolean().default(DEFAULT_ANCHOR_SETTINGS.enabled),
  [FIELD_SELECTED_IDS]: z
    .array(z.string().min(1).max(128))
    .max(MAX_SELECTED_IDS)
    .default(DEFAULT_ANCHOR_SETTINGS.selectedIds),
  [FIELD_PROMPTS]: z.array(AnchorPromptSchema).max(MAX_PROMPTS).default(DEFAULT_ANCHOR_SETTINGS.prompts),
  [FIELD_REINJECT_AFTER_COMPACTION]: z
    .boolean()
    .default(DEFAULT_ANCHOR_SETTINGS.reinjectAfterCompaction),
  [FIELD_REINJECT_TURN_INTERVAL]: z
    .number()
    .min(0)
    .max(MAX_REINJECT_TURN_INTERVAL)
    .default(DEFAULT_REINJECT_TURN_INTERVAL),
  [FIELD_MAX_PROMPT_CHARS]: z.number().min(MIN_TEXT_LIMIT).max(MAX_TEXT_LIMIT).default(DEFAULT_MAX_PROMPT_CHARS),
  [FIELD_MAX_COMBINED_CHARS]: z
    .number()
    .min(MIN_TEXT_LIMIT)
    .max(MAX_TEXT_LIMIT)
    .default(DEFAULT_MAX_COMBINED_CHARS),
  // The union pins the accepted values; a hand-edited document is normalized on
  // the client decode and falls back to the default rather than failing.
  [FIELD_REINJECT_SOURCE]: z.union([z.const('first'), z.const('latest')]).default(DEFAULT_REINJECT_SOURCE),
  [FIELD_MANUAL_SEND_DIGESTS]: z
    .array(z.string().max(32))
    .max(MAX_MANUAL_SEND_DIGESTS)
    .default(DEFAULT_ANCHOR_SETTINGS.manualSendDigests),
})

export const Config = z.object({})

/** One injection, shaped exactly like every other injection this plugin makes. */
function createInjection(text: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: NS },
  })
}

/** Whether one already-admitted message is this plugin's injection. */
function isOwnMessage(message: UserMessage): boolean {
  const source = message.source as { kind?: string; plugin?: string }
  return source.kind === 'plugin' && source.plugin === NS
}

/** Human-facing summary of the current combination, for command output. */
function describeCombination(settings: AnchorSettings): string {
  if (settings.selectedIds.length === 0) return '（当前为「不注入」）'
  return settings.selectedIds
    .map((id) => settings.prompts.find((prompt) => prompt.id === id)?.name ?? id)
    .join(' → ')
}

/** Usage line shared by every rejected `/anchor` form. */
const ANCHOR_USAGE = '用法：`/anchor` 立即定锚当前组合；`/anchor status` 只看状态、不注入。'

/**
 * One `/anchor` invocation: anchors the current combination into the receiving
 * session, or reports the plugin's state for this session.
 *
 * The command path exists because it needs no session turn: the handler runs
 * locally against the agent (that is the documented command contract), so
 * anchoring costs no model call, opens no turn, and leaves the conversation
 * otherwise untouched. Only `/anchor` injects; `/anchor status` is read-only.
 */
function runAnchorCommand(settings: AnchorSettings, invocation: CommandInvocation): CommandResult {
  const input = invocation.rawInput.trim().toLowerCase()
  if (input !== '' && input !== 'status') return { kind: 'error', text: ANCHOR_USAGE }

  const text = combinePromptTexts(settings.prompts, settings.selectedIds)
  const history = readInjectionHistory(
    invocation.agent.session.snapshotEvents(),
    NS,
    normalizeManualSendDigests(settings.manualSendDigests),
  )

  if (input === 'status') {
    const lines = [
      '⚓ 定锚状态',
      `总开关：${settings.enabled ? '开' : '关'} ｜ 组合：${describeCombination(settings)}（${text.length} 字 / 上限 ${settings.maxCombinedChars}）`,
      `重锚：${settings.reinjectSource === 'latest' ? '最近一条本插件注入' : '定锚原文'}` +
        ` ｜ 轮数间隔：${settings.reinjectTurnInterval === 0 ? '关闭' : `${String(settings.reinjectTurnInterval)} 轮`}` +
        ` ｜ 压缩后：${settings.reinjectAfterCompaction ? '补' : '不补'}`,
      history.first === undefined
        ? '本会话：尚无注入（下一条消息的第一个 step 会定锚）'
        : `本会话首条注入：seq ${String(history.first.seq)}（${history.first.manual ? '手发' : '自动'}，${String(history.first.text.length)} 字）`,
    ]
    if (history.latest !== undefined && history.latest.seq !== history.first?.seq) {
      lines.push(
        `最近一次注入：seq ${String(history.latest.seq)}（${history.latest.manual ? '手发' : '自动'}，${String(history.latest.text.length)} 字）`,
      )
    }
    if (history.first !== undefined) {
      lines.push(
        `距上次注入：${String(history.turnsSinceLastInjection)} 轮${history.compactedAfterLastInjection ? '，且之后发生过压缩' : ''}`,
      )
    }
    return { kind: 'success', text: lines.join('\n') }
  }

  if (!settings.enabled) return { kind: 'error', text: `定锚总开关已关闭（设置 → 定锚）。${ANCHOR_USAGE}` }
  if (text === '') return { kind: 'error', text: `当前组合为空（「不注入」），没有可注入的内容。${ANCHOR_USAGE}` }
  if (text.length > settings.maxCombinedChars) {
    return {
      kind: 'error',
      text: `组合 ${String(text.length)} 字，超过合并上限 ${String(settings.maxCombinedChars)} 字，未注入。`,
    }
  }

  invocation.agent.inject(createInjection(text))
  return {
    kind: 'success',
    text:
      `⚓ 已定锚：${String(text.length)} 字 · ${String(settings.selectedIds.length)} 段（${describeCombination(settings)}）\n` +
      '生效：下一个 step 边界，不唤醒驱动、不打断当前回合。\n' +
      '此后本会话的压缩/轮数重锚都会复用这段原文。',
  }
}

export function apply(ctx: Context): void {
  let live: () => AnchorSettings = () => DEFAULT_ANCHOR_SETTINGS
  /** Last over-limit state reported, so a long session warns once per change, not per step. */
  let warnedOverLimit: string | undefined

  // 0.1.2+：installSettingsSection 自由函数已并入 SettingsProvider 方法。
  ctx.settings.installSection(
    ctx,
    NS,
    AnchorSettingsSchema,
    DEFAULT_ANCHOR_SETTINGS,
    {
      setSource: (source) => {
        live = source
      },
      onChange: () => {},
    },
  )

  // `/anchor`：命令在接收它的 agent 上本地执行，不进模型、不开回合，因此定锚不花 token。
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'anchor',
      description: '定锚：把当前组合注入本会话（不发消息、不触发模型回复）',
      input: { hint: '[status]' },
      handler: (invocation) => runAnchorCommand(live(), invocation),
    })
  })

  ctx.on('agent/pre-step', async ({ agent, step, turn }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    // Already injected in this step's batch (another plugin, or a retried step).
    if (decision.messages.some(isOwnMessage)) return decision

    const settings = live()
    if (!settings.enabled) return decision

    const history = readInjectionHistory(
      agent.session.snapshotEvents(),
      NS,
      normalizeManualSendDigests(settings.manualSendDigests),
    )

    let text: string | undefined
    if (history.first === undefined) {
      // Session start only: the session's own first turn. A resumed session that
      // never received an opening prompt (created while injection was off, or
      // before this plugin existed) stays without one instead of getting an
      // "opening" line in the middle of its history.
      if (step !== 1 || turn !== 1) return decision
      text = combinePromptTexts(settings.prompts, settings.selectedIds)
    } else {
      // 续注：唯一触发源是日志，注入后引用 seq 前移，天然只触发一次。
      if (reinjectionReason(history, settings, step) === undefined) return decision
      text = (settings.reinjectSource === 'latest' ? history.latest : history.first)?.text
    }
    if (text === undefined || text === '') return decision

    // One gate for both paths: nothing above the configured combined limit is
    // ever handed to the model, and saying so once per change is enough.
    if (text.length > settings.maxCombinedChars) {
      const signature = `${String(text.length)}/${String(settings.maxCombinedChars)}`
      if (warnedOverLimit !== signature) {
        warnedOverLimit = signature
        ctx.logger.warn(
          'opening prompt is %d chars, above the configured %d-char limit; injection skipped',
          text.length,
          settings.maxCombinedChars,
        )
      }
      return decision
    }

    // Never attach injected context to a step the loop opened with no input:
    // step 1 without a claimed message is the turn-stop path, and extending it
    // would start a turn that no one asked for. A later step (empty batch or
    // not) may carry the injection, which is what post-compaction recovery needs.
    if (step === 1 && decision.messages.length === 0) return decision

    return { ...decision, messages: [createInjection(text), ...decision.messages] }
  })
}

export { NS as ANCHOR_NAMESPACE }
export { digestText } from './digest.ts'
export {
  combinePromptTexts,
  normalizeManualSendDigests,
  normalizeReinjectSource,
  normalizeSelectedIds,
} from './types/anchor-settings.ts'
export type { AnchorPrompt, AnchorSettings, ReinjectSource } from './types/anchor-settings.ts'
export { readInjectionHistory, reinjectionReason } from './trigger.ts'
export type { InjectionHistory, AnchorInjection, ReinjectionReason, ReinjectionPolicy } from './trigger.ts'
export { dropTarget, moveItem } from './order.ts'
