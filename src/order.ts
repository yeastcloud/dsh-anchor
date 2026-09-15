/**
 * Pure list-order helpers for the injection-order editor.
 *
 * The drag target and the ↑/↓ buttons both end in the same primitive — move one
 * item to another index — so the two interactions cannot drift apart.
 *
 * @module @yisiyun/dsh-anchor/order
 */

/** Move one item to `to`, clamped into range; returns a new array. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length) return [...items]
  const next = [...items]
  const [moved] = next.splice(from, 1)
  if (moved === undefined) return [...items]
  const target = Math.min(next.length, Math.max(0, to))
  next.splice(target, 0, moved)
  return next
}

/**
 * Final index for a drop on `over` at the row's `half`.
 *
 * A drag inserts at the marker's position and only then removes the dragged row,
 * so a downward move loses one slot; this is that adjustment in one place.
 *
 * @param from - current index of the dragged row.
 * @param over - index of the hovered row.
 * @param half - which half of the hovered row the pointer is over.
 * @returns the destination index to hand to {@link moveItem}.
 */
export function dropTarget(from: number, over: number, half: 'before' | 'after'): number {
  const insertion = half === 'before' ? over : over + 1
  return from < insertion ? insertion - 1 : insertion
}
