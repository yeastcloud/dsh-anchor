/**
 * Content digest shared by both halves of @yisiyun/dsh-anchor.
 *
 * The composer dock sends the combined opening prompt as an ordinary user
 * message, so the Host recognizes it by content: the client records a digest of
 * what it sent, and the Host digests candidate user messages from the durable
 * log. Storing digests instead of the texts keeps the settings document small
 * (a combination can reach the configured limit) and avoids keeping a second
 * copy of the presets.
 *
 * cyrb53: a small, allocation-free 53-bit hash. Collisions across the handful
 * of recorded digests are not a practical concern, and a collision can only
 * make a manually pasted message count as this plugin's own send — the same
 * consequence as pasting the text that the button would have sent.
 *
 * @module @yisiyun/dsh-anchor/digest
 */

/** Digest one text: 14 lowercase hex characters, stable across both halves. */
export function digestText(text: string): string {
  const normalized = text.trim()
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let index = 0; index < normalized.length; index += 1) {
    const code = normalized.charCodeAt(index)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  const value = 4294967296 * (2097151 & h2) + (h1 >>> 0)
  return value.toString(16).padStart(14, '0')
}
