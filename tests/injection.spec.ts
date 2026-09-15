/**
 * Host-half behaviour: drive the real `agent/pre-step` listener registered by
 * `apply()` with a stub context and a stub session log, and assert the decision
 * it returns. This is the seam the plugin's whole contract lives on, so the
 * cases below are the acceptance criteria rather than internal details.
 *
 * Two shapes appear here and must not be confused: a durable LOG EVENT
 * (`{type, seq, data}`) and a CLAIMED INBOX MESSAGE (a `UserMessage` the loop
 * removed from the inbox). The handler reads both.
 */

import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply, name as pluginName } from '../src/index.ts'
import { DEFAULT_ANCHOR_SETTINGS, type AnchorSettings } from '../src/types/anchor-settings.ts'

interface LogEvent {
  type: string
  seq: number
  data: unknown
}

interface ClaimedMessage {
  id: string
  role: 'user'
  content: { type: 'text'; text: string }[]
  source: { kind: 'user' }
}

interface Harness {
  /** The registered `agent/pre-step` listener. */
  handler: (payload: unknown, next: () => Promise<unknown>) => Promise<unknown>
  /** Replace the settings the host half reads on the next step. */
  setSettings: (settings: AnchorSettings) => void
  /** Replace the context pressure the trigger reads on the next step. */
  setPressure: (tokens: number | undefined) => void
}

/**
 * Where the mounted plugin gets its context pressure.
 *  - `probe`: an injected reader answering with `setPressure` (the default);
 *  - `meter`: the plugin's real projection path, against a stubbed registry;
 *  - `absent`: the real path with no meter mounted at all.
 */
type PressureSource = 'probe' | 'meter' | 'absent'

interface MountOptions {
  pressure?: PressureSource
  /** Value the stubbed `contextPressure` projection reports in `meter` mode. */
  projection?: { pressureTokens?: number; projectedTokens?: number }
}

/** One durable event through the plugin's own eyes. */
function ours(text: string, seq: number): LogEvent {
  return {
    type: 'user/message',
    seq,
    data: { content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: pluginName } },
  }
}

function human(text: string, seq: number): LogEvent {
  return { type: 'user/message', seq, data: { content: [{ type: 'text', text }], source: { kind: 'user' } } }
}

function turnStart(seq: number): LogEvent {
  return { type: 'turn/start', seq, data: { turn: seq } }
}

function compactionSummary(seq: number): LogEvent {
  return { type: 'compaction/summary', seq, data: { summary: [{ type: 'text', text: '摘要' }] } }
}

/** One message the loop claimed from the inbox for this step. */
function claim(text: string): ClaimedMessage {
  return { id: `m-${text}`, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }
}

/** Mount the plugin against a stub context and return the captured listener. */
function mount(options: MountOptions = {}): Harness {
  const source = options.pressure ?? 'probe'
  let current: AnchorSettings = { ...DEFAULT_ANCHOR_SETTINGS }
  let pressure: number | undefined
  let handler: Harness['handler'] | undefined
  const ctx = {
    settings: {
      installSection: (
        _ctx: unknown,
        _ns: unknown,
        _schema: unknown,
        _defaults: unknown,
        options: { setSource: (source: () => AnchorSettings) => void },
      ) => {
        options.setSource(() => current)
      },
    },
    logger: { warn: () => {} },
    inject: () => {},
    on: (event: string, listener: Harness['handler']) => {
      if (event === 'agent/pre-step') handler = listener
    },
    // The plugin reads the token meter through this registry, so leaving it out
    // is exactly what a profile without `dsh-token-meter` looks like.
    get: (name: string) => {
      if (name !== 'sessionProjections' || source !== 'meter') return undefined
      return { snapshot: () => ({ values: { contextPressure: options.projection } }) }
    },
  }
  apply(ctx as unknown as Context, undefined, {
    readPressure: source === 'probe' ? () => pressure : undefined,
  })
  if (handler === undefined) throw new Error('agent/pre-step listener was not registered')
  return {
    handler,
    setSettings: (settings) => {
      current = settings
    },
    setPressure: (tokens) => {
      pressure = tokens
    },
  }
}

interface Decision {
  messages: { content?: unknown; source?: unknown }[]
}

/** Run one pre-step; `claimed` is the batch the loop removed from the inbox. */
async function step(
  harness: Harness,
  log: readonly LogEvent[],
  options: { step?: number; turn?: number; claimed?: unknown[] } = {},
): Promise<Decision> {
  const claimed = options.claimed ?? []
  const payload = {
    agent: { session: { snapshotEvents: () => log } },
    messages: claimed,
    turn: options.turn ?? 1,
    step: options.step ?? 1,
    signal: new AbortController().signal,
  }
  const decision = (await harness.handler(payload, async () => ({ kind: 'enter', messages: claimed }))) as Decision
  return decision
}

/** Text of the first injected message, or undefined when nothing was injected. */
function injectedText(result: Decision): string | undefined {
  const first = result.messages[0]
  const source = first?.source as { kind?: string; plugin?: string } | undefined
  if (source?.plugin !== pluginName) return undefined
  const content = first?.content as { type?: string; text?: string }[] | undefined
  return content?.[0]?.text
}

const PROMPT_A = { id: 'a', name: 'A', text: '锚文原文' }
const PROMPT_B = { id: 'b', name: 'B', text: '后来改选的预设' }
const settingsWith = (selectedIds: string[], patch: Partial<AnchorSettings> = {}): AnchorSettings => ({
  ...DEFAULT_ANCHOR_SETTINGS,
  selectedIds,
  prompts: [PROMPT_A, PROMPT_B],
  ...patch,
})

describe('session-start injection', () => {
  it('prepends the combined selection before the first step of the first turn', async () => {
    const harness = mount()
    harness.setSettings(settingsWith(['a']))
    const result = await step(harness, [], { claimed: [claim('你好')] })
    expect(injectedText(result)).toBe('锚文原文')
    expect(result.messages).toHaveLength(2)
  })

  it('combines several presets in the stored order', async () => {
    const harness = mount()
    harness.setSettings(settingsWith(['b', 'a']))
    const result = await step(harness, [], { claimed: [claim('你好')] })
    expect(injectedText(result)).toBe('后来改选的预设\n\n锚文原文')
  })

  it('stays out of later steps and out of an input-less step 1', async () => {
    const harness = mount()
    harness.setSettings(settingsWith(['a']))
    expect(injectedText(await step(harness, [], { step: 2, claimed: [claim('你好')] }))).toBeUndefined()
    expect(injectedText(await step(harness, [], { claimed: [] }))).toBeUndefined()
  })

  it('never injects an opening prompt into a session that already ran turns', async () => {
    const harness = mount()
    harness.setSettings(settingsWith(['a']))
    // A resumed session (turn continues from the durable log) that never got an
    // opening prompt stays without one: no "opening" line mid-conversation.
    expect(injectedText(await step(harness, [human('旧消息', 0), turnStart(1)], { turn: 5, claimed: [claim('继续')] }))).toBeUndefined()
  })

  it('does nothing while the master switch is off, nothing is selected, or the combination is over limit', async () => {
    const off = mount()
    off.setSettings(settingsWith(['a'], { enabled: false }))
    expect(injectedText(await step(off, [], { claimed: [claim('你好')] }))).toBeUndefined()

    const none = mount()
    none.setSettings(settingsWith([]))
    expect(injectedText(await step(none, [], { claimed: [claim('你好')] }))).toBeUndefined()

    const overLimit = mount()
    overLimit.setSettings(settingsWith(['a'], { maxCombinedChars: 3 }))
    expect(injectedText(await step(overLimit, [], { claimed: [claim('你好')] }))).toBeUndefined()
  })
})

describe('re-injection', () => {
  it('restates the SESSION BASELINE after a compaction, not the current combination', async () => {
    const harness = mount()
    // The user changed the combination after the session started.
    harness.setSettings(settingsWith(['b']))
    const result = await step(harness, [ours('锚文原文', 0), human('继续', 1), compactionSummary(2)], {
      turn: 5,
      claimed: [claim('继续')],
    })
    expect(injectedText(result)).toBe('锚文原文')
  })

  it('repeats a COMBINED baseline verbatim', async () => {
    const harness = mount()
    harness.setSettings(settingsWith(['b']))
    const result = await step(harness, [ours('甲\n\n乙', 0), compactionSummary(1)], {
      turn: 5,
      claimed: [claim('继续')],
    })
    expect(injectedText(result)).toBe('甲\n\n乙')
  })

  it('recovers mid-turn, where the loop claimed no new user message', async () => {
    const harness = mount()
    harness.setSettings(settingsWith(['b']))
    const result = await step(harness, [ours('锚文原文', 0), compactionSummary(1)], { turn: 5, step: 4, claimed: [] })
    expect(injectedText(result)).toBe('锚文原文')
  })

  it('leaves a healthy session alone until the turn interval is reached', async () => {
    const harness = mount()
    harness.setSettings(settingsWith(['a'], { reinjectTurnInterval: 20 }))
    const short = [ours('锚文原文', 0), ...Array.from({ length: 5 }, (_, index) => turnStart(index + 1))]
    expect(injectedText(await step(harness, short, { turn: 6, claimed: [claim('继续')] }))).toBeUndefined()

    const long = [ours('锚文原文', 0), ...Array.from({ length: 20 }, (_, index) => turnStart(index + 1))]
    expect(injectedText(await step(harness, long, { turn: 21, claimed: [claim('继续')] }))).toBe('锚文原文')
  })

  it('honours the two re-injection switches independently', async () => {
    const noCompaction = mount()
    noCompaction.setSettings(settingsWith(['a'], { reinjectAfterCompaction: false }))
    expect(
      injectedText(
        await step(noCompaction, [ours('锚文原文', 0), compactionSummary(1)], { turn: 5, claimed: [claim('继续')] }),
      ),
    ).toBeUndefined()

    const noInterval = mount()
    noInterval.setSettings(settingsWith(['a'], { reinjectTurnInterval: 0 }))
    const long = [ours('锚文原文', 0), ...Array.from({ length: 30 }, (_, index) => turnStart(index + 1))]
    expect(injectedText(await step(noInterval, long, { turn: 31, claimed: [claim('继续')] }))).toBeUndefined()
  })

  it('applies the combined limit to re-injection too', async () => {
    const harness = mount()
    harness.setSettings(settingsWith(['a'], { maxCombinedChars: 3 }))
    const result = await step(harness, [ours('锚文原文', 0), compactionSummary(1)], {
      turn: 5,
      claimed: [claim('继续')],
    })
    expect(injectedText(result)).toBeUndefined()
  })

  it('skips a batch that already carries its own message (retried step)', async () => {
    const harness = mount()
    harness.setSettings(settingsWith(['b']))
    const claimed = [{ content: [{ type: 'text', text: '锚文原文' }], source: { kind: 'plugin', plugin: pluginName } }]
    const result = await step(harness, [ours('锚文原文', 0), compactionSummary(1)], { turn: 5, claimed })
    expect(result.messages).toHaveLength(1)
  })

  it('never repeats a baseline that carried no text', async () => {
    const harness = mount()
    harness.setSettings(settingsWith(['b']))
    const result = await step(harness, [ours('   ', 0), compactionSummary(1)], { turn: 5, claimed: [claim('继续')] })
    expect(injectedText(result)).toBeUndefined()
  })
})

describe('delegated (subagent) sessions', () => {
  /** The provenance event `dsh-subagent` writes into a delegated child's log. */
  const delegated = (seq: number): LogEvent => ({
    type: 'sandbox/mode',
    seq,
    data: { mode: 'workspace-write', source: 'delegation' },
  })

  it('stays out of a delegated session by default', async () => {
    const harness = mount()
    harness.setSettings(settingsWith(['a']))
    const result = await step(harness, [delegated(0)], { claimed: [claim('派活')] })
    expect(injectedText(result)).toBeUndefined()
    expect(result.messages).toHaveLength(1)
  })

  it('anchors a delegated session once the user opts in', async () => {
    const harness = mount()
    harness.setSettings(settingsWith(['a'], { anchorSubagents: true }))
    const result = await step(harness, [delegated(0)], { claimed: [claim('派活')] })
    expect(injectedText(result)).toBe('锚文原文')
  })

  it('skips re-injection in a delegated session that already carries a baseline', async () => {
    const harness = mount()
    harness.setSettings(settingsWith(['a']))
    const log = [delegated(0), ours('锚文原文', 1), compactionSummary(2)]
    expect(injectedText(await step(harness, log, { turn: 5, claimed: [claim('继续')] }))).toBeUndefined()

    harness.setSettings(settingsWith(['a'], { anchorSubagents: true }))
    expect(injectedText(await step(harness, log, { turn: 5, claimed: [claim('继续')] }))).toBe('锚文原文')
  })
})

describe('re-injection source', () => {
  const second = '后来重锚的文本'

  it('repeats the opening prompt by default, even after a newer injection', async () => {
    const harness = mount()
    harness.setSettings(settingsWith(['b'], { reinjectSource: 'first' }))
    const log = [ours('锚文原文', 0), ours(second, 1), compactionSummary(2)]
    const result = await step(harness, log, { turn: 5, claimed: [claim('继续')] })
    expect(injectedText(result)).toBe('锚文原文')
  })

  it('repeats the newest injection when that source is selected', async () => {
    const harness = mount()
    harness.setSettings(settingsWith(['b'], { reinjectSource: 'latest' }))
    const log = [ours('锚文原文', 0), ours(second, 1), compactionSummary(2)]
    const result = await step(harness, log, { turn: 5, claimed: [claim('继续')] })
    expect(injectedText(result)).toBe(second)
  })

  // `refresh` is the one source that reads live settings instead of the log: an
  // edited preset or selection reaches the running session at its next re-anchor.
  it('states the current combination when the source is refresh', async () => {
    const harness = mount()
    harness.setSettings(settingsWith(['a'], { reinjectSource: 'refresh' }))
    const log = [ours('锚文原文', 0), compactionSummary(1)]
    expect(injectedText(await step(harness, log, { turn: 5, claimed: [claim('继续')] }))).toBe('锚文原文')

    harness.setSettings(settingsWith(['b'], { reinjectSource: 'refresh' }))
    expect(injectedText(await step(harness, log, { turn: 6, claimed: [claim('继续')] }))).toBe('后来改选的预设')
  })

  it('still refuses a refreshed combination above the combined limit', async () => {
    const harness = mount()
    harness.setSettings(settingsWith(['a'], { reinjectSource: 'refresh', maxCombinedChars: 2 }))
    const log = [ours('锚', 0), compactionSummary(1)]
    expect(injectedText(await step(harness, log, { turn: 5, claimed: [claim('继续')] }))).toBeUndefined()
  })

  it('ignores an ordinary user message, so a session can have no baseline', async () => {
    const harness = mount()
    harness.setSettings(settingsWith(['b']))
    const result = await step(harness, [human('路过的一句话', 0), compactionSummary(1)], {
      turn: 5,
      claimed: [claim('继续')],
    })
    expect(injectedText(result)).toBeUndefined()
  })
})

describe('context-token pressure', () => {
  const THRESHOLD = 1000
  const withThreshold = (patch: Partial<AnchorSettings> = {}): AnchorSettings =>
    settingsWith(['a'], { reinjectTokenThreshold: THRESHOLD, ...patch })
  /** The opening anchor, then two turns opened since it. */
  const twoTurns = [ours('锚文原文', 0), turnStart(1), turnStart(2)]

  it('never fires while the threshold is 0', async () => {
    const harness = mount()
    harness.setSettings(settingsWith(['a'], { reinjectTokenThreshold: 0 }))
    harness.setPressure(999_999)
    expect(injectedText(await step(harness, twoTurns, { turn: 3, claimed: [claim('继续')] }))).toBeUndefined()
  })

  it('stays quiet while the reading is below the threshold', async () => {
    const harness = mount()
    harness.setSettings(withThreshold())
    harness.setPressure(THRESHOLD - 1)
    expect(injectedText(await step(harness, twoTurns, { turn: 3, claimed: [claim('继续')] }))).toBeUndefined()
  })

  it('re-anchors at the first step of a later turn, never mid-turn', async () => {
    const harness = mount()
    harness.setSettings(withThreshold())
    harness.setPressure(50_000)
    // A crossing that happens while a turn runs waits for the next turn instead
    // of lengthening the one in flight.
    expect(injectedText(await step(harness, twoTurns, { turn: 3, step: 4, claimed: [] }))).toBeUndefined()
    expect(injectedText(await step(harness, twoTurns, { turn: 4, claimed: [claim('继续')] }))).toBe('锚文原文')
  })

  it('fires once per crossing: a context that stays heavy stays quiet', async () => {
    const harness = mount()
    harness.setSettings(withThreshold())
    harness.setPressure(50_000)
    expect(injectedText(await step(harness, twoTurns, { turn: 3, claimed: [claim('继续')] }))).toBe('锚文原文')

    const anchored = [...twoTurns, ours('锚文原文', 3), turnStart(4)]
    expect(injectedText(await step(harness, anchored, { turn: 4, claimed: [claim('继续')] }))).toBeUndefined()
    expect(injectedText(await step(harness, anchored, { turn: 5, claimed: [claim('继续')] }))).toBeUndefined()
    expect(injectedText(await step(harness, anchored, { turn: 6, claimed: [claim('继续')] }))).toBeUndefined()
  })

  it('re-arms when a compaction drops the reading back below the threshold', async () => {
    const harness = mount()
    // The compaction trigger is off, so the drop itself injects nothing and the
    // pressure trigger alone owns the way back up.
    harness.setSettings(withThreshold({ reinjectAfterCompaction: false }))
    harness.setPressure(9000)
    expect(injectedText(await step(harness, twoTurns, { turn: 3, claimed: [claim('继续')] }))).toBe('锚文原文')

    const compacted = [...twoTurns, ours('锚文原文', 3), compactionSummary(4), turnStart(5)]
    harness.setPressure(200)
    expect(injectedText(await step(harness, compacted, { turn: 6, step: 3, claimed: [] }))).toBeUndefined()
    harness.setPressure(1200)
    expect(injectedText(await step(harness, compacted, { turn: 6, claimed: [claim('继续')] }))).toBe('锚文原文')
  })

  it('never fires in the turn that already injected the baseline', async () => {
    // The reference seq moved, so the newest injection is the step being served
    // (a retried step, for example): the turn is not a next turn yet.
    const harness = mount()
    harness.setSettings(withThreshold())
    harness.setPressure(50_000)
    expect(
      injectedText(await step(harness, [ours('锚文原文', 0)], { turn: 1, claimed: [claim('继续')] })),
    ).toBeUndefined()
  })

  it('keeps the crossing pending when a gate refuses the injection', async () => {
    const harness = mount()
    harness.setSettings(withThreshold({ maxCombinedChars: 3 }))
    harness.setPressure(50_000)
    expect(injectedText(await step(harness, twoTurns, { turn: 3, claimed: [claim('继续')] }))).toBeUndefined()

    harness.setSettings(withThreshold())
    expect(injectedText(await step(harness, twoTurns, { turn: 4, claimed: [claim('继续')] }))).toBe('锚文原文')
  })

  it('takes its text from the selected re-anchor source, like the other triggers', async () => {
    const harness = mount()
    harness.setSettings(withThreshold({ reinjectSource: 'refresh', selectedIds: ['b'] }))
    harness.setPressure(50_000)
    expect(injectedText(await step(harness, twoTurns, { turn: 3, claimed: [claim('继续')] }))).toBe('后来改选的预设')
  })

  it('reads the figure the composer shows from the mounted meter', async () => {
    const harness = mount({
      pressure: 'meter',
      projection: { pressureTokens: 20_000, projectedTokens: 30_000 },
    })
    harness.setSettings(withThreshold())
    expect(injectedText(await step(harness, twoTurns, { turn: 3, claimed: [claim('继续')] }))).toBe('锚文原文')
  })

  it('prefers the next request projection over the last provider sample', async () => {
    const harness = mount({
      pressure: 'meter',
      projection: { pressureTokens: 20_000, projectedTokens: 500 },
    })
    harness.setSettings(withThreshold())
    expect(injectedText(await step(harness, twoTurns, { turn: 3, claimed: [claim('继续')] }))).toBeUndefined()
  })

  it('falls back to the provider sample before any projection exists', async () => {
    const harness = mount({ pressure: 'meter', projection: { pressureTokens: 5000 } })
    harness.setSettings(withThreshold())
    expect(injectedText(await step(harness, twoTurns, { turn: 3, claimed: [claim('继续')] }))).toBe('锚文原文')
  })

  it('is inert, and silent, when no token meter is mounted', async () => {
    const harness = mount({ pressure: 'absent' })
    harness.setSettings(withThreshold())
    const result = await step(harness, twoTurns, { turn: 3, claimed: [claim('继续')] })
    expect(injectedText(result)).toBeUndefined()
    expect(result.messages).toHaveLength(1)
  })
})
