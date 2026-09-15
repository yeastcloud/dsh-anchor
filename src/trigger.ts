/**
 * Pure re-injection decision for @yeastcloud/dsh-anchor.
 *
 * A session's opening prompt decays: a long turn chain pushes it far behind the
 * live context, and a summarizing compaction can shadow it out of the surface
 * entirely. This module reads the durable log and decides when a baseline has
 * to be injected again.
 *
 * Two kinds of injection count:
 *  - automatic ones this plugin appended (`source.plugin` = the namespace);
 *  - a combination sent by hand from the composer dock, recognized because the
 *    client recorded the digest of what it sent. The composer delivers that as
 *    an ordinary user message, so content is the only thing that can identify
 *    it — the client's record is what keeps a plain user message from being
 *    mistaken for one.
 *
 * No process-local state: the log is the only source of truth, so a resume,
 * restart, or replay reaches the same decision, and a re-injection cannot
 * repeat (its own message moves the reference seq forward on the next pass).
 *
 * @module @yeastcloud/dsh-anchor/trigger
 */

/** Structural view of one durable session event (`SessionEvent` is assignable). */
export interface AnchorLogEvent {
  readonly type: string
  readonly seq: number
  readonly data: unknown
}

/** One opening-prompt injection found in the durable log. */
export interface AnchorInjection {
  /** Seq of the message carrying the text. */
  readonly seq: number
  /** Trimmed text of the message; empty when it carried none. */
  readonly text: string
}

/** What the durable log states about this plugin's injections. */
export interface InjectionHistory {
  /** Earliest injection of the session — the opening prompt. */
  readonly first: AnchorInjection | undefined
  /** Most recent injection of the session. */
  readonly latest: AnchorInjection | undefined
  /** Seq of the newest injection, or -1 when the session has none. */
  readonly lastInjectionSeq: number
  /** A completed summarizing compaction landed after the newest injection. */
  readonly compactedAfterLastInjection: boolean
  /** Turns opened after the newest injection. */
  readonly turnsSinceLastInjection: number
}

/** Settings that gate re-injection. */
export interface ReinjectionPolicy {
  readonly reinjectAfterCompaction: boolean
  readonly reinjectTurnInterval: number
}

/** Why the baseline is being injected again. */
export type ReinjectionReason = 'compaction' | 'turns'

/** Event type a summarizing compaction appends once its summary is committed. */
const COMPACTION_SUMMARY = 'compaction/summary'
/** Event type the loop appends when a turn opens. */
const TURN_START = 'turn/start'
/** Event type carrying model-visible user messages, this plugin's included. */
const USER_MESSAGE = 'user/message'

/** The `source` field of a message payload, when it has an object one. */
function sourceOf(data: unknown): { kind?: unknown; plugin?: unknown } | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const source = (data as { source?: unknown }).source
  if (typeof source !== 'object' || source === null) return undefined
  return source as { kind?: unknown; plugin?: unknown }
}

/** Event type `dsh-subagent` stamps when it captures the delegation policy. */
const SANDBOX_MODE = 'sandbox/mode'
/** Event type `dsh-subagent` stamps when it captures the approval policy. */
const APPROVAL_POLICY = 'approval/policy'
/** Provenance value those stamped events carry on a delegated child's log. */
const DELEGATION_SOURCE = 'delegation'

/**
 * Whether one durable event log belongs to a delegated (subagent) session.
 *
 * `dsh-subagent` appends the captured delegation policy onto the child's own log
 * as `sandbox/mode` / `approval/policy` events carrying `source: 'delegation'`,
 * deliberately so the child's provenance is reconstructable from its log alone.
 * That makes the marker readable here without any live parent lookup.
 *
 * @param events - ordered durable events (`session.snapshotEvents()`).
 * @returns true when a delegation created this session.
 */
export function isDelegatedSession(events: readonly AnchorLogEvent[]): boolean {
  for (const event of events) {
    if (event.type !== SANDBOX_MODE && event.type !== APPROVAL_POLICY) continue
    if (typeof event.data !== 'object' || event.data === null) continue
    if ((event.data as { source?: unknown }).source === DELEGATION_SOURCE) return true
  }
  return false
}

/** Whether one event data payload is a message this plugin sourced itself. */
function isOwnMessage(data: unknown, plugin: string): boolean {
  const source = sourceOf(data)
  return source !== undefined && source.kind === 'plugin' && source.plugin === plugin
}

/** Concatenated text of one message payload (empty when it carries none). */
function messageText(data: unknown): string {
  if (typeof data !== 'object' || data === null) return ''
  const content = (data as { content?: unknown }).content
  if (!Array.isArray(content)) return ''
  let text = ''
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const candidate = block as { type?: unknown; text?: unknown }
    if (candidate.type === 'text' && typeof candidate.text === 'string') text += candidate.text
  }
  return text.trim()
}

/**
 * Read this plugin's injection history out of the durable event log.
 *
 * Compaction replacement messages carry `source.plugin === "compact"`, so they
 * never count: only messages this plugin sourced itself enter the history.
 *
 * @param events - ordered durable events (`session.snapshotEvents()`).
 * @param plugin - the plugin namespace recorded in the injected message source.
 * @returns the earliest and newest injections plus what happened since the newest.
 */
export function readInjectionHistory(
  events: readonly AnchorLogEvent[],
  plugin: string,
): InjectionHistory {
  let first: AnchorInjection | undefined
  let latest: AnchorInjection | undefined
  let compacted = false
  let turns = 0

  for (const event of events) {
    if (event.type === USER_MESSAGE) {
      if (!isOwnMessage(event.data, plugin)) continue
      const injection: AnchorInjection = { seq: event.seq, text: messageText(event.data) }
      if (first === undefined) first = injection
      latest = injection
      compacted = false
      turns = 0
      continue
    }
    if (latest === undefined) continue
    if (event.type === COMPACTION_SUMMARY) compacted = true
    else if (event.type === TURN_START) turns += 1
  }

  return {
    first,
    latest,
    lastInjectionSeq: latest?.seq ?? -1,
    compactedAfterLastInjection: compacted,
    turnsSinceLastInjection: turns,
  }
}

/**
 * Decide whether this step re-injects a baseline.
 *
 * Compaction fires on the first step boundary after it lands, including inside
 * a running turn, so the very next model request carries the prompt again. The
 * turn interval is a turn-boundary trigger: it fires on step 1 only, so a long
 * session re-injects alongside the user's message rather than mid-tool-loop.
 *
 * @param history - facts read from the durable log.
 * @param policy - the settings that gate re-injection.
 * @param step - the step the loop is proposing.
 * @returns the trigger that fired, or undefined when nothing must be injected.
 */
export function reinjectionReason(
  history: InjectionHistory,
  policy: ReinjectionPolicy,
  step: number,
): ReinjectionReason | undefined {
  if (history.lastInjectionSeq < 0) return undefined
  if (policy.reinjectAfterCompaction && history.compactedAfterLastInjection) return 'compaction'
  if (
    policy.reinjectTurnInterval > 0
    && step === 1
    && history.turnsSinceLastInjection >= policy.reinjectTurnInterval
  ) {
    return 'turns'
  }
  return undefined
}
