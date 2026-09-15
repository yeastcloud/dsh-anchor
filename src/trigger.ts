/**
 * Pure re-injection decision for @yeastcloud/dsh-anchor.
 *
 * A session's opening prompt decays: a long turn chain pushes it far behind the
 * live context, and a summarizing compaction can shadow it out of the surface
 * entirely. This module reads the durable log — and, for the pressure trigger
 * only, one measurement the caller supplies — and decides when a baseline has to
 * be injected again.
 *
 * Two kinds of injection count:
 *  - automatic ones this plugin appended (`source.plugin` = the namespace);
 *  - a combination sent by hand from the composer dock, recognized because the
 *    client recorded the digest of what it sent. The composer delivers that as
 *    an ordinary user message, so content is the only thing that can identify
 *    it — the client's record is what keeps a plain user message from being
 *    mistaken for one.
 *
 * No process-local state for the log-driven triggers: the log is the only
 * source of truth, so a resume, restart, or replay reaches the same decision,
 * and a re-injection cannot repeat (its own message moves the reference seq
 * forward on the next pass).
 *
 * The one exception is the context-pressure trigger, whose input is a
 * measurement rather than an event: it is EDGE-triggered on one armed flag per
 * session ({@link pressureStep}), because a level test would re-inject on every
 * following turn for as long as the context stays heavy.
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

/**
 * Settings that gate re-injection.
 *
 * The first two are read from the durable log alone; `reinjectTokenThreshold`
 * needs a measurement of the live session, so the caller supplies one
 * ({@link PressureStep}) alongside the history.
 */
export interface ReinjectionPolicy {
  readonly reinjectAfterCompaction: boolean
  readonly reinjectTurnInterval: number
  readonly reinjectTokenThreshold: number
}

/** Why the baseline is being injected again. */
export type ReinjectionReason = 'compaction' | 'turns' | 'pressure'

/**
 * One reading's effect on one session's pressure trigger.
 *
 * `armed` is per session and lives in the process, not in the log: it is true
 * for a session this process has not measured yet, and a profile restart
 * therefore re-arms every session. A restarted process cannot know whether the
 * crossing it is looking at already fired, so it may re-anchor once and then
 * hold the once-per-crossing rule again.
 */
export interface PressureStep {
  /** Whether this reading crosses the threshold now: armed, measured, at or above it. */
  readonly crossed: boolean
  /**
   * The armed flag the session remembers when this step injects nothing. A
   * crossing leaves it armed, and the injection path disarms it, so a gate that
   * refuses the injection leaves the crossing pending instead of swallowing it.
   */
  readonly armed: boolean
}

/**
 * Fold one context-pressure reading into a session's armed flag.
 *
 * Edge-triggered with re-arming, never a level test: a reading at or above the
 * threshold fires once and stays disarmed for as long as it stays there, so a
 * context that is merely large cannot re-anchor turn after turn. Only a reading
 * strictly below the threshold re-arms the trigger, which is what makes any
 * pruning that brings the context back down — a compaction above all — start a
 * new crossing. A session with no reading at all (no token meter mounted, no
 * provider usage reported yet) changes nothing: only a measurement can arm or
 * fire the trigger.
 *
 * @param armed - the flag this session had before the reading.
 * @param tokens - the current context pressure, or undefined when unmeasured.
 * @param threshold - configured token threshold; 0 keeps the trigger off.
 * @returns the crossing verdict and the flag to remember for the next step.
 */
export function pressureStep(
  armed: boolean,
  tokens: number | undefined,
  threshold: number,
): PressureStep {
  if (threshold <= 0 || tokens === undefined) return { crossed: false, armed }
  if (tokens >= threshold) return { crossed: armed, armed }
  return { crossed: false, armed: true }
}

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
 * turn interval and the token threshold are turn-boundary triggers: both fire
 * on step 1 only, so a long or a heavy session re-injects alongside the user's
 * message rather than mid-tool-loop.
 *
 * The pressure crossing is judged at step 1 of a turn that opened AFTER the last
 * injection (`turnsSinceLastInjection > 0`): the trigger never extends the turn
 * already running, never injects at a step no input opened, and never fires
 * twice for one turn — including the turn that injected the crossing's text.
 *
 * @param history - facts read from the durable log.
 * @param policy - the settings that gate re-injection.
 * @param step - the step the loop is proposing.
 * @param pressure - this step's pressure reading, when the caller took one.
 * @returns the trigger that fired, or undefined when nothing must be injected.
 */
export function reinjectionReason(
  history: InjectionHistory,
  policy: ReinjectionPolicy,
  step: number,
  pressure?: PressureStep,
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
  if (
    policy.reinjectTokenThreshold > 0
    && pressure?.crossed === true
    && step === 1
    && history.turnsSinceLastInjection > 0
  ) {
    return 'pressure'
  }
  return undefined
}
