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
 *    either completed a summarizing compaction, opened
 *    `reinjectTurnInterval` turns since the last injection, or crossed the
 *    `reinjectTokenThreshold` context pressure at the first step of a new turn.
 *
 * Which text a re-injection injects is the user's choice (`reinjectSource`):
 * the session's FIRST injection (the opening prompt, so an anchored combination
 * stays a one-off), the LATEST one (which makes an anchored combination a
 * deliberate switch for the rest of the session), or a REFRESH of the current
 * settings combination (so an edited preset or selection reaches the running
 * session at its next re-anchor). The first two always come from the durable
 * log; only `refresh` reads the live settings, which is the one case where a
 * running conversation can be given text it has never seen.
 *
 * The pressure trigger is the one input that is a measurement rather than a log
 * event: it reads the official token meter's `contextPressure` projection
 * (`./meter.ts`, the same figure the composer shows) and keeps one armed flag
 * per session, so a context that stays above the threshold re-anchors once
 * instead of turn after turn ({@link pressureStep}). Everything else about it —
 * the step-1 boundary, the claimed-input requirement, `reinjectSource`, and the
 * combined-character gate — is what the log-driven triggers already use.
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
  DEFAULT_REINJECT_TOKEN_THRESHOLD,
  DEFAULT_REINJECT_TURN_INTERVAL,
  FIELD_ENABLED,
  FIELD_MAX_COMBINED_CHARS,
  FIELD_MAX_PROMPT_CHARS,
  FIELD_PROMPTS,
  FIELD_REINJECT_AFTER_COMPACTION,
  FIELD_ANCHOR_SUBAGENTS,
  FIELD_REINJECT_SOURCE,
  FIELD_REINJECT_TOKEN_THRESHOLD,
  FIELD_REINJECT_TURN_INTERVAL,
  FIELD_SELECTED_IDS,
  MAX_PROMPTS,
  MAX_PROMPT_ID_CHARS,
  MAX_PROMPT_NAME_CHARS,
  MAX_REINJECT_TOKEN_THRESHOLD,
  MAX_REINJECT_TURN_INTERVAL,
  MAX_SELECTED_IDS,
  MAX_TEXT_LIMIT,
  MIN_TEXT_LIMIT,
  NS,
  combinePromptTexts,
  type AnchorSettings,
  type ReinjectSource,
} from './types/anchor-settings.ts'
import {
  isDelegatedSession,
  pressureStep,
  readInjectionHistory,
  reinjectionReason,
  type PressureStep,
} from './trigger.ts'
import { meterPressure, type PressureReader } from './meter.ts'
import { translate, type AnchorCopyKey, type AnchorLocale, type CopyVars } from './copy.ts'

export const name = NS

/** 本插件必备宿主服务：settings（设置命名空间，Cordis 4 起直读 ctx.settings 必须显式声明）。 */
export const inject: string[] = ['settings']

const AnchorPromptSchema = z.object({
  id: z.string().min(1).max(MAX_PROMPT_ID_CHARS),
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
    .array(z.string().min(1).max(MAX_PROMPT_ID_CHARS))
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
  [FIELD_REINJECT_TOKEN_THRESHOLD]: z
    .number()
    .min(0)
    .max(MAX_REINJECT_TOKEN_THRESHOLD)
    .default(DEFAULT_REINJECT_TOKEN_THRESHOLD),
  [FIELD_MAX_PROMPT_CHARS]: z.number().min(MIN_TEXT_LIMIT).max(MAX_TEXT_LIMIT).default(DEFAULT_MAX_PROMPT_CHARS),
  [FIELD_MAX_COMBINED_CHARS]: z
    .number()
    .min(MIN_TEXT_LIMIT)
    .max(MAX_TEXT_LIMIT)
    .default(DEFAULT_MAX_COMBINED_CHARS),
  // The union pins the accepted values; a hand-edited document is normalized on
  // the client decode and falls back to the default rather than failing.
  [FIELD_REINJECT_SOURCE]: z
    .union([z.const('first'), z.const('latest'), z.const('refresh')])
    .default(DEFAULT_REINJECT_SOURCE),
  [FIELD_ANCHOR_SUBAGENTS]: z.boolean().default(DEFAULT_ANCHOR_SETTINGS.anchorSubagents),
})

export const Config = z.object({})

/** Environment surface read for the locale of host-side output. */
export type HostEnvironment = Readonly<Record<string, string | undefined>>

/** Seams the composing caller (and tests) may supply to the host half. */
export interface HostOptions {
  /** Environment read for the output locale; defaults to `process.env`. */
  readonly env?: HostEnvironment
  /**
   * Context-pressure source for the token trigger; defaults to the official
   * token meter ({@link meterPressure}).
   */
  readonly readPressure?: PressureReader
}

/** Translator bound to one locale, as every host-side message uses it. */
type HostTranslate = (key: AnchorCopyKey, vars?: CopyVars) => string

/**
 * Resolve the locale of host-side output from the process environment.
 *
 * The Host half has no locale service — the DSH language preference lives in the
 * browser client — so `/anchor` and the over-limit warning follow the shell
 * instead: `LC_ALL` wins over `LANG`, and only the leading tag is matched
 * (`en_US.UTF-8` → `en`, `zh_CN.UTF-8` → `zh`). Anything unrecognised, including
 * an unset variable, lands on `zh`, the language this plugin's copy is written
 * in first.
 * @param env - environment to read; defaults to `process.env`.
 * @returns the locale of every host-side message.
 */
export function pickHostLocale(env: HostEnvironment = process.env): AnchorLocale {
  const tag = (env['LC_ALL'] ?? env['LANG'] ?? '').toLowerCase().split(/[._-]/)[0] ?? ''
  return tag === 'en' ? 'en' : 'zh'
}

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

/** Model-facing text of one injection, for command output and duplicate checks. */
function injectionText(message: UserMessage): string {
  return message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('')
}

/** Human-facing summary of the current combination, for command output. */
function describeCombination(settings: AnchorSettings, t: HostTranslate): string {
  if (settings.selectedIds.length === 0) return t('command.combinationEmpty')
  return settings.selectedIds
    .map((id) => settings.prompts.find((prompt) => prompt.id === id)?.name ?? id)
    .join(' → ')
}

/** The `/anchor status` name of each re-injection source. */
const REINJECT_SOURCE_COPY_KEY: Readonly<Record<ReinjectSource, AnchorCopyKey>> = {
  first: 'command.reinjectSourceFirst',
  latest: 'command.reinjectSourceLatest',
  refresh: 'command.reinjectSourceRefresh',
}

/**
 * One `/anchor` invocation: anchors the current combination into the receiving
 * session, or reports the plugin's state for this session.
 *
 * The command path exists because it needs no session turn: the handler runs
 * locally against the agent (that is the documented command contract), so
 * anchoring costs no model call, opens no turn, and leaves the conversation
 * otherwise untouched. Only `/anchor` injects; `/anchor status` is read-only.
 * @param settings - live settings document.
 * @param invocation - the command invocation being served.
 * @param locale - locale of every message this invocation returns.
 * @returns the command result: injected text, a report, or a refusal.
 */
function runAnchorCommand(
  settings: AnchorSettings,
  invocation: CommandInvocation,
  locale: AnchorLocale,
  pendingAnchors: Map<string, string>,
): CommandResult {
  const t: HostTranslate = (key, vars) => translate(locale, key, vars)
  const input = invocation.rawInput.trim().toLowerCase()
  if (input !== '' && input !== 'status') return { kind: 'error', text: t('command.usage') }

  const text = combinePromptTexts(settings.prompts, settings.selectedIds)
  // The anchor is held here, not in the agent inbox. Inbox entries are pending
  // INPUT: the client renders them as a queued message and the loop may open a
  // turn for them, so a next-turn anchor produced a reply with no user message,
  // while a next-step one extended whatever turn was already running. The
  // pre-step hook injects this slot at the first step of the next turn instead.
  const history = readInjectionHistory(invocation.agent.session.snapshotEvents(), NS)
  const pending = pendingAnchors.get(invocation.agent.session.id)

  if (input === 'status') {
    const lines = [
      t('command.statusTitle'),
      t('command.statusSwitch', {
        state: t(settings.enabled ? 'command.stateOn' : 'command.stateOff'),
        combination: describeCombination(settings, t),
        chars: text.length,
        max: settings.maxCombinedChars,
      }),
      t('command.statusReinject', {
        source: t(REINJECT_SOURCE_COPY_KEY[settings.reinjectSource]),
        interval: settings.reinjectTurnInterval === 0
          ? t('command.policyOff')
          : t('command.intervalTurns', { turns: settings.reinjectTurnInterval }),
        threshold: settings.reinjectTokenThreshold === 0
          ? t('command.policyOff')
          : t('command.thresholdTokens', { tokens: settings.reinjectTokenThreshold }),
        afterCompaction: t(
          settings.reinjectAfterCompaction
            ? 'command.afterCompactionYes'
            : 'command.afterCompactionNo',
        ),
      }),
    ]
    if (pending !== undefined) {
      lines.push(t('command.pendingAnchor', { chars: pending.length }))
    }
    if (history.first === undefined) {
      lines.push(
        pending !== undefined ? t('command.noInjectionYetQueued') : t('command.noInjectionYet'),
      )
    } else {
      lines.push(t('command.firstInjection', { seq: history.first.seq, chars: history.first.text.length }))
    }
    if (history.latest !== undefined && history.latest.seq !== history.first?.seq) {
      lines.push(t('command.latestInjection', { seq: history.latest.seq, chars: history.latest.text.length }))
    }
    if (history.first !== undefined) {
      lines.push(
        t('command.turnsSince', { turns: history.turnsSinceLastInjection })
        + (history.compactedAfterLastInjection ? t('command.compactedSince') : ''),
      )
    }
    return { kind: 'success', text: lines.join('\n') }
  }

  if (!settings.enabled) {
    return { kind: 'error', text: t('command.switchOff', { usage: t('command.usage') }) }
  }
  if (text === '') {
    return { kind: 'error', text: t('command.emptyCombination', { usage: t('command.usage') }) }
  }
  if (text.length > settings.maxCombinedChars) {
    return {
      kind: 'error',
      text: t('command.overLimit', { chars: text.length, max: settings.maxCombinedChars }),
    }
  }
  if (pending === text) {
    return { kind: 'success', text: t('command.duplicate') }
  }

  pendingAnchors.set(invocation.agent.session.id, text)
  return {
    kind: 'success',
    // The refresh source decides what a later re-anchor states, so promising
    // that it reuses this text would be wrong there.
    text: t(settings.reinjectSource === 'refresh' ? 'command.anchoredRefresh' : 'command.anchored', {
      chars: text.length,
      segments: settings.selectedIds.length,
      combination: describeCombination(settings, t),
    }),
  }
}

/**
 * @param ctx - host context providing the settings service (and, optionally, commands).
 * @param _config - unused: this plugin reads no host configuration.
 * @param options - seams for host-side output and for the context-pressure reading; tests inject both instead of touching the process environment or a live profile.
 */
export function apply(ctx: Context, _config?: unknown, options: HostOptions = {}): void {
  const locale = pickHostLocale(options.env)
  const t: HostTranslate = (key, vars) => translate(locale, key, vars)
  const readPressure: PressureReader =
    options.readPressure ?? ((session) => meterPressure(ctx, session))
  /** Manual anchors awaiting the first step of the next turn, keyed by session. */
  const pendingAnchors = new Map<string, string>()
  /**
   * Armed flag of the pressure trigger, keyed by session: true means the next
   * reading at or above the threshold is a new crossing. A session this process
   * has not measured yet is armed — after a restart the plugin cannot know
   * whether the crossing it sees already fired, and one re-anchor is the
   * bounded cost of that (see `PressureStep`).
   */
  const pressureArmed = new Map<string, boolean>()
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
      description: t('command.description'),
      input: { hint: '[status]' },
      handler: (invocation) => runAnchorCommand(live(), invocation, locale, pendingAnchors),
    })
  })

  ctx.on('agent/pre-step', async ({ agent, step, turn }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    // Already injected in this step's batch (another plugin, or a retried step).
    if (decision.messages.some(isOwnMessage)) return decision

    const settings = live()
    if (!settings.enabled) return decision

    // A manual anchor waits for the first step of the next turn: nothing enters
    // the inbox, so it is neither rendered as pending input nor able to open a
    // turn of its own, and requiring step 1 keeps it from lengthening the turn
    // that is already running.
    const pendingAnchor = pendingAnchors.get(agent.session.id)
    if (pendingAnchor !== undefined && step === 1 && decision.messages.length > 0) {
      pendingAnchors.delete(agent.session.id)
      return { ...decision, messages: [createInjection(pendingAnchor), ...decision.messages] }
    }

    const events = agent.session.snapshotEvents()
    // Delegated (subagent) sessions are skipped unless the user opts in: the
    // persona and discipline belong to the session a human steers, and a child
    // replaying them spends tokens on every delegation.
    if (!settings.anchorSubagents && isDelegatedSession(events)) return decision

    const history = readInjectionHistory(events, NS)

    let text: string | undefined
    let crossing = false
    if (history.first === undefined) {
      // Session start only: the session's own first turn. A resumed session that
      // never received an opening prompt (created while injection was off, or
      // before this plugin existed) stays without one instead of getting an
      // "opening" line in the middle of its history.
      if (step !== 1 || turn !== 1) return decision
      text = combinePromptTexts(settings.prompts, settings.selectedIds)
    } else {
      // 续注：压缩与轮数两个触发源只读日志，注入后引用 seq 前移，天然只触发一次。
      // token 压力是唯一的例外：读数来自官方计量，是否已触发由按会话的已触发位记着。
      const reading = settings.reinjectTokenThreshold > 0
        ? readPressure(agent.session)
        : undefined
      const pressure: PressureStep = pressureStep(
        pressureArmed.get(agent.session.id) ?? true,
        reading,
        settings.reinjectTokenThreshold,
      )
      // Re-arming is written here, at every reading: a drop below the threshold
      // is what makes the next crossing fire, and it can land mid-turn (a
      // compaction), where the trigger itself is not allowed to fire.
      pressureArmed.set(agent.session.id, pressure.armed)
      const reason = reinjectionReason(history, settings, step, pressure)
      if (reason === undefined) return decision
      crossing = reason === 'pressure'
      text = settings.reinjectSource === 'refresh'
        // `refresh` states the CURRENT combination instead of repeating the log:
        // an edited preset or selection reaches the running session here, and
        // the same gates below still apply to the refreshed text.
        ? combinePromptTexts(settings.prompts, settings.selectedIds)
        : (settings.reinjectSource === 'latest' ? history.latest : history.first)?.text
    }
    if (text === undefined || text === '') return decision

    // One gate for both paths: nothing above the configured combined limit is
    // ever handed to the model, and saying so once per change is enough.
    if (text.length > settings.maxCombinedChars) {
      const signature = `${String(text.length)}/${String(settings.maxCombinedChars)}`
      if (warnedOverLimit !== signature) {
        warnedOverLimit = signature
        ctx.logger.warn(
          t('log.overLimit', { chars: text.length, max: settings.maxCombinedChars }),
        )
      }
      return decision
    }

    // Never attach injected context to a step the loop opened with no input:
    // step 1 without a claimed message is the turn-stop path, and extending it
    // would start a turn that no one asked for. A later step (empty batch or
    // not) may carry the injection, which is what post-compaction recovery needs.
    if (step === 1 && decision.messages.length === 0) return decision

    // The crossing is consumed only here. Every gate above may still refuse the
    // injection, and a refusal must leave the crossing armed so the next turn's
    // first step can try again rather than losing it.
    if (crossing) pressureArmed.set(agent.session.id, false)

    return { ...decision, messages: [createInjection(text), ...decision.messages] }
  })
}

export { NS as ANCHOR_NAMESPACE }
export {
  REINJECT_SOURCES,
  combinePromptTexts,
  normalizeReinjectSource,
  normalizeSelectedIds,
  normalizeTokenThreshold,
} from './types/anchor-settings.ts'
export type { AnchorPrompt, AnchorSettings, ReinjectSource } from './types/anchor-settings.ts'
export { pressureStep, readInjectionHistory, reinjectionReason } from './trigger.ts'
export type {
  InjectionHistory,
  AnchorInjection,
  PressureStep,
  ReinjectionReason,
  ReinjectionPolicy,
} from './trigger.ts'
export { meterPressure } from './meter.ts'
export type { PressureReader } from './meter.ts'
export { dropTarget, moveItem } from './order.ts'
