/**
 * Preset-library import / export for @yeastcloud/dsh-anchor.
 *
 * One document carries a whole library — the presets, their ids and names and
 * texts, plus the current combination — so a library built on one machine can be
 * restored on another. The document is self-describing: `format` says who wrote
 * it and `version` says which reading of it applies, so a future release can
 * migrate instead of guessing.
 *
 * Serialising and parsing are pure. The caller supplies the timestamp, nothing
 * here reads the clock, and no function touches the DOM, the settings store or
 * the network. Parsing validates the ENTIRE document before returning anything:
 * a document that is wrong anywhere yields a reason and no library at all, so an
 * import can never half-apply.
 *
 * The limits are the durable ones from `./types/anchor-settings.ts`, not local
 * copies: a document this parser accepts is a library the Host schema and the
 * tolerant decoder accept too.
 *
 * @module @yeastcloud/dsh-anchor/preset-transfer
 */

import {
  MAX_PROMPTS,
  MAX_PROMPT_ID_CHARS,
  MAX_PROMPT_NAME_CHARS,
  MAX_SELECTED_IDS,
  MAX_TEXT_LIMIT,
  type AnchorPrompt,
} from './types/anchor-settings.ts'

/** Marker identifying a document this plugin exported. */
export const PRESET_DOCUMENT_FORMAT = 'dsh-anchor.presets'

/** Document revision this module writes, and the only one it reads. */
export const PRESET_DOCUMENT_VERSION = 1

/** The exported document: the library, the combination, and the envelope. */
export interface PresetDocument {
  /** Always {@link PRESET_DOCUMENT_FORMAT}; anything else is a foreign file. */
  format: string
  /** {@link PRESET_DOCUMENT_VERSION} of the writer. */
  version: number
  /** ISO timestamp of the export; human-readable, ignored by import. */
  exportedAt: string
  /** The whole preset library, in library order. */
  presets: AnchorPrompt[]
  /** The combination as it stood at export time, in injection order. */
  selectedIds: string[]
}

/**
 * Why one document was refused.
 *
 * Each reason covers one field or one structural rule, so the reason alone says
 * what to fix:
 *  - `empty`: nothing but whitespace in the file (truncated download, wrong file);
 *  - `json`: the text does not parse as JSON;
 *  - `format`: not a JSON object, or `format` is missing or names another producer;
 *  - `version`: `version` is not the revision this module reads;
 *  - `presets`: `presets` is missing or not an array, or an element is not an object;
 *  - `preset-id`: an id is missing, not a string, empty or above {@link MAX_PROMPT_ID_CHARS};
 *  - `preset-name`: a name is missing, not a string, empty or above {@link MAX_PROMPT_NAME_CHARS};
 *  - `preset-text`: a text is missing, not a string or above {@link MAX_TEXT_LIMIT};
 *  - `duplicate-id`: two presets carry the same id;
 *  - `too-many`: more presets than {@link MAX_PROMPTS};
 *  - `selection`: `selectedIds` is not an array, holds a non-string, an unknown or
 *    repeated id, or more entries than {@link MAX_SELECTED_IDS}.
 */
export const PRESET_IMPORT_REASONS = [
  'empty',
  'json',
  'format',
  'version',
  'presets',
  'preset-id',
  'preset-name',
  'preset-text',
  'duplicate-id',
  'too-many',
  'selection',
] as const

/** One reason a document can be refused; see {@link PRESET_IMPORT_REASONS}. */
export type PresetImportReason = (typeof PRESET_IMPORT_REASONS)[number]

/** A validated document, ready to replace a library. */
export interface PresetImportSuccess {
  ok: true
  /** The document's own timestamp; undefined when the file carried none. */
  exportedAt: string | undefined
  /** The validated library, in document order. */
  presets: AnchorPrompt[]
  /** The validated combination; every id is present in `presets`. */
  selectedIds: string[]
}

/** A refused document: the reason, and nothing else. */
export interface PresetImportFailure {
  ok: false
  reason: PresetImportReason
}

/** Either a validated library or the one reason it was refused. */
export type PresetImportResult = PresetImportSuccess | PresetImportFailure

/**
 * Serialise one library into the document {@link parsePresetDocument} reads back.
 * @param library - presets to store and the combination to carry along.
 * @param exportedAt - ISO timestamp from the caller's own clock.
 * @returns the document as indented JSON, newline-terminated.
 */
export function serializePresetDocument(
  library: { prompts: readonly AnchorPrompt[]; selectedIds: readonly string[] },
  exportedAt: string,
): string {
  const document: PresetDocument = {
    format: PRESET_DOCUMENT_FORMAT,
    version: PRESET_DOCUMENT_VERSION,
    exportedAt,
    presets: library.prompts.map((prompt) => ({ id: prompt.id, name: prompt.name, text: prompt.text })),
    selectedIds: [...library.selectedIds],
  }
  return `${JSON.stringify(document, null, 2)}\n`
}

/** Narrow one raw value into the accepted preset, or report what is wrong with it. */
function readPreset(
  raw: unknown,
  ids: Set<string>,
): { ok: true; preset: AnchorPrompt } | { ok: false; reason: PresetImportReason } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, reason: 'presets' }
  const candidate = raw as Record<string, unknown>
  const id = candidate['id']
  if (typeof id !== 'string' || id === '' || id.length > MAX_PROMPT_ID_CHARS) {
    return { ok: false, reason: 'preset-id' }
  }
  if (ids.has(id)) return { ok: false, reason: 'duplicate-id' }
  const name = candidate['name']
  if (typeof name !== 'string' || name === '' || name.length > MAX_PROMPT_NAME_CHARS) {
    return { ok: false, reason: 'preset-name' }
  }
  const text = candidate['text']
  if (typeof text !== 'string' || text.length > MAX_TEXT_LIMIT) return { ok: false, reason: 'preset-text' }
  return { ok: true, preset: { id, name, text } }
}

/**
 * Validate one exported document.
 *
 * Nothing is returned until the whole document has been checked, so a caller
 * that replaces its library with the result cannot half-import a broken file.
 * @param text - raw file content.
 * @returns the validated library, or the single reason the document was refused.
 */
export function parsePresetDocument(text: string): PresetImportResult {
  if (text.trim() === '') return { ok: false, reason: 'empty' }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    // JSON.parse throws SyntaxError for any malformed text; no other exception is possible here.
    return { ok: false, reason: 'json' }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, reason: 'format' }
  const document = raw as Record<string, unknown>
  if (document['format'] !== PRESET_DOCUMENT_FORMAT) return { ok: false, reason: 'format' }
  if (document['version'] !== PRESET_DOCUMENT_VERSION) return { ok: false, reason: 'version' }
  const exportedAt = document['exportedAt']
  if (exportedAt !== undefined && typeof exportedAt !== 'string') return { ok: false, reason: 'format' }

  const presetsRaw = document['presets']
  if (!Array.isArray(presetsRaw)) return { ok: false, reason: 'presets' }
  if (presetsRaw.length > MAX_PROMPTS) return { ok: false, reason: 'too-many' }
  const ids = new Set<string>()
  const presets: AnchorPrompt[] = []
  for (const item of presetsRaw) {
    const read = readPreset(item, ids)
    if (!read.ok) return { ok: false, reason: read.reason }
    ids.add(read.preset.id)
    presets.push(read.preset)
  }

  const selectionRaw = document['selectedIds']
  if (!Array.isArray(selectionRaw)) return { ok: false, reason: 'selection' }
  if (selectionRaw.length > MAX_SELECTED_IDS) return { ok: false, reason: 'selection' }
  const selectedIds: string[] = []
  for (const id of selectionRaw) {
    if (typeof id !== 'string' || !ids.has(id) || selectedIds.includes(id)) {
      return { ok: false, reason: 'selection' }
    }
    selectedIds.push(id)
  }

  return { ok: true, exportedAt, presets, selectedIds }
}
