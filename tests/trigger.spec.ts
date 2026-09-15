/**
 * Trigger decisions read only the durable log, so they are testable without an
 * agent: every case below is one log shape plus the settings that gate it.
 */

import { describe, expect, it } from 'vitest'
import { readInjectionHistory, reinjectionReason, type AnchorLogEvent } from '../src/trigger.ts'

const NS = 'dsh-anchor'

/** One message this plugin injected. */
function ours(text: string, seq: number): AnchorLogEvent {
  return {
    type: 'user/message',
    seq,
    data: { content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: NS } },
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

const EVERY = { reinjectAfterCompaction: true, reinjectTurnInterval: 20 }

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
})
