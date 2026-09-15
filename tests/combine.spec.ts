/**
 * Combination and ordering primitives: how several presets become one opening
 * prompt, how the selection survives a shrinking library, and how a drop maps
 * onto an array move.
 */

import { describe, expect, it } from 'vitest'
import {
  MAX_SELECTED_IDS,
  combinePromptTexts,
  normalizeSelectedIds,
  type AnchorPrompt,
} from '../src/types/anchor-settings.ts'
import { dropTarget, moveItem } from '../src/order.ts'

const prompts: AnchorPrompt[] = [
  { id: 'a', name: 'A', text: '甲' },
  { id: 'b', name: 'B', text: '乙' },
  { id: 'c', name: 'C', text: '丙' },
]

describe('combinePromptTexts', () => {
  it('joins the selected presets in selection order', () => {
    expect(combinePromptTexts(prompts, ['c', 'a'])).toBe('丙\n\n甲')
  })

  it('trims each part, drops empty ones, and skips ids the library lost', () => {
    const withBlank: AnchorPrompt[] = [
      { id: 'a', name: 'A', text: '  甲  ' },
      { id: 'b', name: 'B', text: '   ' },
    ]
    expect(combinePromptTexts(withBlank, ['a', 'b'])).toBe('甲')
    expect(combinePromptTexts(prompts, ['a', 'missing', 'b'])).toBe('甲\n\n乙')
  })

  it('is empty for an empty selection', () => {
    expect(combinePromptTexts(prompts, [])).toBe('')
  })
})

describe('normalizeSelectedIds', () => {
  it('keeps order, drops duplicates and unknown ids', () => {
    expect(normalizeSelectedIds(['c', 'a', 'c', 'gone', 'b'], prompts)).toEqual(['c', 'a', 'b'])
  })

  it('caps the combination length', () => {
    const many: AnchorPrompt[] = Array.from({ length: MAX_SELECTED_IDS + 5 }, (_, index) => ({
      id: `p${String(index)}`,
      name: `P${String(index)}`,
      text: 'x',
    }))
    expect(normalizeSelectedIds(many.map((prompt) => prompt.id), many)).toHaveLength(MAX_SELECTED_IDS)
  })
})

describe('order helpers', () => {
  it('moves one item with post-removal indexing', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c'])
    expect(moveItem(['a', 'b', 'c'], 9, 0)).toEqual(['a', 'b', 'c'])
  })

  it('maps a drop onto the destination index, compensating downward moves', () => {
    // Dragging a (0) below c (2) lands last.
    expect(dropTarget(0, 2, 'after')).toBe(2)
    // Dragging a (0) above c (2) lands between b and c.
    expect(dropTarget(0, 2, 'before')).toBe(1)
    // Dragging c (2) above a (0) lands first.
    expect(dropTarget(2, 0, 'before')).toBe(0)
    // Dropping b back in its own slot changes nothing.
    expect(dropTarget(1, 1, 'after')).toBe(1)

    expect(moveItem(['a', 'b', 'c'], 0, dropTarget(0, 2, 'after'))).toEqual(['b', 'c', 'a'])
    expect(moveItem(['a', 'b', 'c'], 0, dropTarget(0, 2, 'before'))).toEqual(['b', 'a', 'c'])
    expect(moveItem(['a', 'b', 'c'], 2, dropTarget(2, 0, 'before'))).toEqual(['c', 'a', 'b'])
  })
})
