/**
 * Trigger decisions read the durable log — plus, for the token trigger only, one
 * measured reading and one armed flag per session — so they are testable without
 * an agent: every case below is one log shape plus the settings that gate it.
 */

import { describe, expect, it } from 'vitest'
import {
  isAnchorInjectionSource,
  isDelegatedSession,
  pressureStep,
  readInjectionHistory,
  reinjectionReason,
  type AnchorLogEvent,
} from '../src/trigger.ts'
import { INJECTION_SOURCE_KIND } from '../src/types/anchor-settings.ts'

const NS = 'dsh-anchor'

/**
 * One message this plugin injected BEFORE the line change: the retired
 * catch-all source every producer used on the 0.1.6 line.
 */
function ours(text: string, seq: number): AnchorLogEvent {
  return {
    type: 'user/message',
    seq,
    data: { content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: NS } },
  }
}

/**
 * The same injection as session format V4 sees it.
 *
 * `dsh-session-format-v3-to-v4` rewrites a released
 * `{ kind: 'plugin', plugin: 'dsh-anchor' }` through `producerKind`, which falls
 * back to `` `plugin:${plugin}` `` for a producer in neither of its tables — so
 * this is literally the shape an upgraded session's history has, and the shape
 * the plugin writes from now on.
 */
function migrated(text: string, seq: number): AnchorLogEvent {
  return {
    type: 'user/message',
    seq,
    data: { content: [{ type: 'text', text }], source: { kind: INJECTION_SOURCE_KIND } },
  }
}

/** One message a human submitted (a hand-sent combination looks like this too). */
function human(text: string, seq: number): AnchorLogEvent {
  return { type: 'user/message', seq, data: { content: [{ type: 'text', text }], source: { kind: 'user' } } }
}

/** The compaction replacement message: a user message, but not this plugin's. */
function compactReplacement(seq: number): AnchorLogEvent {
  return {
    type: 'user/message',
    seq,
    data: {
      content: [{ type: 'text', text: '会话摘要…' }],
      source: { kind: 'plugin', plugin: 'compact', compactionId: 'c1' },
    },
  }
}

function turnStart(seq: number): AnchorLogEvent {
  return { type: 'turn/start', seq, data: { turn: 1 } }
}

function compactionSummary(seq: number): AnchorLogEvent {
  return { type: 'compaction/summary', seq, data: { summary: [{ type: 'text', text: '摘要' }] } }
}

const EVERY = { reinjectAfterCompaction: true, reinjectTurnInterval: 20, reinjectTokenThreshold: 0 }
/** The same policy with the token trigger on. */
const WITH_PRESSURE = { ...EVERY, reinjectTokenThreshold: 1000 }

/** One event carrying the provenance `dsh-subagent` stamps on a delegated child. */
function delegatedEvent(seq: number, type: string): AnchorLogEvent {
  return { type, seq, data: { mode: 'workspace-write', source: 'delegation' } }
}

describe('isDelegatedSession', () => {
  it('recognises the delegation provenance dsh-subagent appends', () => {
    expect(isDelegatedSession([human('你好', 0), delegatedEvent(1, 'sandbox/mode')])).toBe(true)
    expect(isDelegatedSession([delegatedEvent(0, 'approval/policy')])).toBe(true)
  })

  it('leaves an ordinary session alone', () => {
    expect(isDelegatedSession([human('你好', 0), turnStart(1)])).toBe(false)
    expect(isDelegatedSession([ours('锚文', 0)])).toBe(false)
  })

  it('reads the provenance value, not the mere presence of the event', () => {
    const switched = (source: unknown): AnchorLogEvent => ({
      type: 'sandbox/mode',
      seq: 0,
      data: { mode: 'workspace-write', source },
    })
    expect(isDelegatedSession([switched('user')])).toBe(false)
    expect(isDelegatedSession([switched(undefined)])).toBe(false)
    expect(isDelegatedSession([{ type: 'sandbox/mode', seq: 0, data: null }])).toBe(false)
  })
})

describe('isAnchorInjectionSource', () => {
  it('accepts both source shapes this plugin has ever written', () => {
    expect(isAnchorInjectionSource({ kind: INJECTION_SOURCE_KIND }, NS)).toBe(true)
    expect(isAnchorInjectionSource({ kind: 'plugin', plugin: NS }, NS)).toBe(true)
  })

  it('rejects another producer, whatever shape it uses', () => {
    expect(isAnchorInjectionSource({ kind: 'plugin:compact' }, NS)).toBe(false)
    expect(isAnchorInjectionSource({ kind: 'plugin', plugin: 'compact' }, NS)).toBe(false)
    expect(isAnchorInjectionSource({ kind: 'user' }, NS)).toBe(false)
    expect(isAnchorInjectionSource(undefined, NS)).toBe(false)
    expect(isAnchorInjectionSource('dsh-anchor', NS)).toBe(false)
  })

  it('keeps the plugin parameter meaningful', () => {
    expect(isAnchorInjectionSource({ kind: 'plugin:other' }, 'other')).toBe(true)
    expect(isAnchorInjectionSource({ kind: INJECTION_SOURCE_KIND }, 'other')).toBe(false)
  })
})

describe('readInjectionHistory', () => {
  it('reports nothing for a session that was never injected', () => {
    const history = readInjectionHistory([human('你好', 0), turnStart(1)], NS)
    expect(history.first).toBeUndefined()
    expect(history.latest).toBeUndefined()
    expect(history.lastInjectionSeq).toBe(-1)
    expect(history.compactedAfterLastInjection).toBe(false)
    expect(history.turnsSinceLastInjection).toBe(0)
  })

  it('captures the opening prompt and counts turns since it', () => {
    const history = readInjectionHistory(
      [human('你好', 0), ours('请用中文回答', 1), turnStart(2), turnStart(3), turnStart(4)],
      NS,
    )
    expect(history.first?.text).toBe('请用中文回答')
    expect(history.latest?.seq).toBe(1)
    expect(history.lastInjectionSeq).toBe(1)
    expect(history.turnsSinceLastInjection).toBe(3)
    expect(history.compactedAfterLastInjection).toBe(false)
  })

  it('ignores the compaction replacement message when looking for its own', () => {
    const history = readInjectionHistory([ours('锚文', 0), compactionSummary(1), compactReplacement(2)], NS)
    expect(history.first?.text).toBe('锚文')
    expect(history.lastInjectionSeq).toBe(0)
    expect(history.compactedAfterLastInjection).toBe(true)
  })

  it('reads a post-migration injection as its own', () => {
    // The line change rewrites every stored injection's source; a session that
    // crossed it must keep its baseline, or the anchor would silently stop
    // re-anchoring that conversation.
    const history = readInjectionHistory([migrated('开工锚', 0), turnStart(1), turnStart(2)], NS)
    expect(history.first?.text).toBe('开工锚')
    expect(history.lastInjectionSeq).toBe(0)
    expect(history.turnsSinceLastInjection).toBe(2)
  })

  it('mixes pre- and post-migration injections in one history', () => {
    const history = readInjectionHistory([ours('原始锚文', 0), turnStart(1), migrated('原始锚文', 2)], NS)
    expect(history.first?.seq).toBe(0)
    expect(history.latest?.seq).toBe(2)
  })

  it('sees a summarizing compaction that landed after the injection', () => {
    const history = readInjectionHistory([ours('锚文', 0), turnStart(1), compactionSummary(2)], NS)
    expect(history.compactedAfterLastInjection).toBe(true)
  })

  it('keeps the FIRST injection as first and the newest as latest', () => {
    const history = readInjectionHistory(
      [ours('原始锚文', 0), turnStart(1), ours('原始锚文', 2), turnStart(3)],
      NS,
    )
    expect(history.first?.text).toBe('原始锚文')
    expect(history.latest?.seq).toBe(2)
    expect(history.turnsSinceLastInjection).toBe(1)
  })

  it('resets the compaction and turn counters at each injection', () => {
    const history = readInjectionHistory(
      [ours('锚文', 0), compactionSummary(1), turnStart(2), ours('锚文', 3)],
      NS,
    )
    expect(history.compactedAfterLastInjection).toBe(false)
    expect(history.turnsSinceLastInjection).toBe(0)
  })

  it('joins text blocks and reports a textless injection as empty text', () => {
    const joined = readInjectionHistory(
      [
        {
          type: 'user/message',
          seq: 0,
          data: {
            content: [{ type: 'text', text: '前半' }, { type: 'text', text: '后半' }],
            source: { kind: 'plugin', plugin: NS },
          },
        },
      ],
      NS,
    )
    expect(joined.first?.text).toBe('前半后半')

    const empty = readInjectionHistory([ours('   ', 0)], NS)
    // The injection EXISTS (so the live selection is not consulted) but carries
    // nothing to repeat.
    expect(empty.first).toBeDefined()
    expect(empty.first?.text).toBe('')
  })
})

describe('reinjectionReason', () => {
  const compacted = readInjectionHistory([ours('锚文', 0), compactionSummary(1)], NS)
  const longSession = readInjectionHistory(
    [ours('锚文', 0), ...Array.from({ length: 20 }, (_, index) => turnStart(index + 1))],
    NS,
  )

  it('fires on a compaction at any step, including mid-turn', () => {
    expect(reinjectionReason(compacted, EVERY, 1)).toBe('compaction')
    expect(reinjectionReason(compacted, EVERY, 5)).toBe('compaction')
  })

  it('honours the compaction switch', () => {
    expect(reinjectionReason(compacted, { ...EVERY, reinjectAfterCompaction: false }, 3)).toBeUndefined()
  })

  it('fires on the turn interval only at a turn boundary and only from the threshold up', () => {
    const nineteen = readInjectionHistory(
      [ours('锚文', 0), ...Array.from({ length: 19 }, (_, index) => turnStart(index + 1))],
      NS,
    )
    expect(reinjectionReason(nineteen, EVERY, 1)).toBeUndefined()
    expect(reinjectionReason(longSession, EVERY, 1)).toBe('turns')
    expect(reinjectionReason(longSession, EVERY, 2)).toBeUndefined()
  })

  it('treats interval 0 as disabled and never fires without an injection', () => {
    expect(reinjectionReason(longSession, { ...EVERY, reinjectTurnInterval: 0 }, 1)).toBeUndefined()
    const never = readInjectionHistory([human('你好', 0), turnStart(1)], NS)
    expect(reinjectionReason(never, EVERY, 1)).toBeUndefined()
  })

  it('fires on a pressure crossing at a turn boundary only', () => {
    // One turn opened since the newest injection, and the interval is far away:
    // the pressure crossing is the only trigger that can fire here.
    const crossed = { crossed: true, armed: true }
    const oneTurn = readInjectionHistory([ours('锚文', 0), turnStart(1)], NS)
    expect(reinjectionReason(oneTurn, WITH_PRESSURE, 1, crossed)).toBe('pressure')
    expect(reinjectionReason(oneTurn, WITH_PRESSURE, 2, crossed)).toBeUndefined()
  })

  it('ignores a pressure crossing while the turn is the one that injected', () => {
    // No turn has opened since the newest injection, so this is not a next turn.
    const sameTurn = readInjectionHistory([ours('锚文', 0)], NS)
    expect(reinjectionReason(sameTurn, WITH_PRESSURE, 1, { crossed: true, armed: true })).toBeUndefined()
  })

  it('lets the compaction trigger win the step, and honours a disabled threshold', () => {
    const oneTurn = readInjectionHistory([ours('锚文', 0), turnStart(1)], NS)
    expect(reinjectionReason(compacted, WITH_PRESSURE, 1, { crossed: true, armed: true })).toBe('compaction')
    expect(reinjectionReason(oneTurn, EVERY, 1, { crossed: true, armed: true })).toBeUndefined()
    expect(reinjectionReason(oneTurn, WITH_PRESSURE, 1, { crossed: false, armed: false })).toBeUndefined()
  })
})

describe('pressureStep', () => {
  const T = 1000

  it('never crosses while the threshold is 0 or nothing was measured', () => {
    expect(pressureStep(true, 999_999, 0)).toEqual({ crossed: false, armed: true })
    expect(pressureStep(true, undefined, T)).toEqual({ crossed: false, armed: true })
    expect(pressureStep(false, undefined, T)).toEqual({ crossed: false, armed: false })
  })

  it('re-arms on a reading below the threshold', () => {
    expect(pressureStep(true, T - 1, T)).toEqual({ crossed: false, armed: true })
    expect(pressureStep(false, T - 1, T)).toEqual({ crossed: false, armed: true })
  })

  it('crosses only once: an armed reading at or above fires, a disarmed one stays quiet', () => {
    expect(pressureStep(true, T, T)).toEqual({ crossed: true, armed: true })
    expect(pressureStep(true, 10 * T, T)).toEqual({ crossed: true, armed: true })
    // The level test this rule replaces would fire again here.
    expect(pressureStep(false, 10 * T, T)).toEqual({ crossed: false, armed: false })
  })
})
