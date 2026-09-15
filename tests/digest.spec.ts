/**
 * Content digest: the composer dock sends the combination as an ordinary user
 * message, so the Host can only recognize it by content. The digest has to be
 * stable across both halves and tolerant of the trim the log applies.
 */

import { describe, expect, it } from 'vitest'
import { digestText } from '../src/digest.ts'

describe('digestText', () => {
  it('is deterministic and 14 lowercase hex characters', () => {
    const digest = digestText('组合文本')
    expect(digest).toMatch(/^[0-9a-f]{14}$/)
    expect(digestText('组合文本')).toBe(digest)
  })

  it('ignores surrounding whitespace, matching what the log stores', () => {
    expect(digestText('  组合文本\n')).toBe(digestText('组合文本'))
  })

  it('separates different texts, including whitespace-joined vs newline-joined', () => {
    expect(digestText('甲')).not.toBe(digestText('乙'))
    expect(digestText('甲\n\n乙')).not.toBe(digestText('甲乙'))
  })

  it('separates a long combination from its own prefix', () => {
    const long = '字'.repeat(8000)
    expect(digestText(long)).not.toBe(digestText('字'.repeat(7999)))
  })
})
