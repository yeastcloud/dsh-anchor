/**
 * Shared durable settings contract for @yeastcloud/dsh-anchor.
 * Host (schemastery) and client (decode) must stay in sync.
 *
 * The opening prompt is a free COMBINATION of presets: `selectedIds` is ordered
 * and its order is the concatenation order. An empty selection means "inject
 * nothing" — that state is derived, never stored, so the exclusive 「不注入」
 * choice and the preset checkboxes cannot disagree.
 */

export const NS = 'dsh-anchor'

/**
 * `source.kind` every injection this plugin appends carries.
 *
 * Session format V4 (the 0.1.7 line) refuses the retired catch-all `plugin` kind
 * and demands a producer-owned one; its own V3→V4 migration rewrites a released
 * `{ kind: 'plugin', plugin: 'dsh-anchor' }` source to exactly this string, so
 * writing it here keeps the injections of an old session and of a new one
 * indistinguishable in the log.
 */
export type AnchorInjectionSourceKind = 'plugin:dsh-anchor'

/**
 * The injection source kind as a value. Annotated with the literal type on
 * purpose: the annotation proves `plugin:${NS}` is that literal, so the
 * namespace, the profile entry id (`cordis.patch.yml`), and the declared
 * producer kind cannot drift apart silently.
 */
export const INJECTION_SOURCE_KIND: AnchorInjectionSourceKind = `plugin:${NS}`

/** The retired catch-all `source.kind`; only ever read, never written again. */
export const RETIRED_PLUGIN_SOURCE_KIND = 'plugin'

export const FIELD_ENABLED = 'enabled'
export const FIELD_SELECTED_IDS = 'selectedIds'
export const FIELD_PROMPTS = 'prompts'
export const FIELD_REINJECT_AFTER_COMPACTION = 'reinjectAfterCompaction'
export const FIELD_REINJECT_TURN_INTERVAL = 'reinjectTurnInterval'
export const FIELD_REINJECT_TOKEN_THRESHOLD = 'reinjectTokenThreshold'
export const FIELD_MAX_PROMPT_CHARS = 'maxPromptChars'
export const FIELD_MAX_COMBINED_CHARS = 'maxCombinedChars'
export const FIELD_REINJECT_SOURCE = 'reinjectSource'
export const FIELD_ANCHOR_SUBAGENTS = 'anchorSubagents'

/**
 * Retired single-selection field. Never written again; decoded only so a
 * settings document or Host half from before the combination model still
 * resolves to the same opening prompt.
 */
export const FIELD_SELECTED_ID_LEGACY = 'selectedId'

export interface AnchorPrompt {
  id: string
  name: string
  text: string
}

/**
 * What text a re-anchor injects.
 *  - `first`: the earliest injection of the session (the opening prompt);
 *  - `latest`: the most recent one, which includes a combination anchored with
 *    `/anchor` — inside that session, a deliberate switch;
 *  - `refresh`: the CURRENT combination of the live settings
 *    (`combinePromptTexts(settings.prompts, settings.selectedIds)`), so editing
 *    presets or the selection changes what the next re-anchor states.
 * The first two read the injections already in the durable log, so they differ
 * only after a later one; `refresh` reads the settings instead and can therefore
 * differ from every injection the session has seen.
 */
export type ReinjectSource = 'first' | 'latest' | 'refresh'

/** Every accepted re-injection source, in the order the settings page offers them. */
export const REINJECT_SOURCES = ['first', 'latest', 'refresh'] as const

export interface AnchorSettings {
  enabled: boolean
  /** Ordered preset ids; the order IS the injection order. Empty injects nothing. */
  selectedIds: string[]
  prompts: AnchorPrompt[]
  /** Re-inject the session's baseline opening prompt after a summarizing compaction. */
  reinjectAfterCompaction: boolean
  /** Re-inject the baseline every N turns opened since the last injection; 0 disables. */
  reinjectTurnInterval: number
  /**
   * Re-inject once the session's context pressure crosses this many tokens, as
   * the official token meter reports it; 0 disables. An absolute count because
   * that is the figure the composer's context meter shows.
   */
  reinjectTokenThreshold: number
  /** Authoring limit for one preset text; never truncates stored prompts. */
  maxPromptChars: number
  /** Injection gate: a combined opening prompt above this is not injected. */
  maxCombinedChars: number
  /** Which injection a re-injection repeats. */
  reinjectSource: ReinjectSource
  /** Whether delegated (subagent) sessions are anchored at all. */
  anchorSubagents: boolean
}

export const DEFAULT_PROMPTS: AnchorPrompt[] = [
  { id: 'default', name: '默认提示词', text: '请用中文回答，保持简洁高效。' },
]

/** Default turn interval between two baseline re-injections. */
export const DEFAULT_REINJECT_TURN_INTERVAL = 20
/** Upper bound accepted for the turn interval. */
export const MAX_REINJECT_TURN_INTERVAL = 10_000

/** Default token threshold: 0 keeps the pressure trigger off. */
export const DEFAULT_REINJECT_TOKEN_THRESHOLD = 0
/** Upper bound accepted for the token threshold; above any context window. */
export const MAX_REINJECT_TOKEN_THRESHOLD = 10_000_000

/** Structural cap on the preset library. */
export const MAX_PROMPTS = 100
/** Structural cap on how many presets may combine into one opening prompt. */
export const MAX_SELECTED_IDS = 20
/** Structural cap on a preset name. */
export const MAX_PROMPT_NAME_CHARS = 200
/** Structural cap on a preset id; the Host schema and the decoder enforce the same one. */
export const MAX_PROMPT_ID_CHARS = 128
export const DEFAULT_MAX_PROMPT_CHARS = 8000
export const DEFAULT_MAX_COMBINED_CHARS = 8000
/** Bounds accepted for either user-configured limit. */
export const MIN_TEXT_LIMIT = 100
export const MAX_TEXT_LIMIT = 100_000

export const DEFAULT_REINJECT_SOURCE: ReinjectSource = 'first'

export const DEFAULT_ANCHOR_SETTINGS: AnchorSettings = {
  enabled: true,
  selectedIds: ['default'],
  prompts: [...DEFAULT_PROMPTS],
  reinjectAfterCompaction: true,
  reinjectTurnInterval: DEFAULT_REINJECT_TURN_INTERVAL,
  reinjectTokenThreshold: DEFAULT_REINJECT_TOKEN_THRESHOLD,
  maxPromptChars: DEFAULT_MAX_PROMPT_CHARS,
  maxCombinedChars: DEFAULT_MAX_COMBINED_CHARS,
  reinjectSource: DEFAULT_REINJECT_SOURCE,
  anchorSubagents: false,
}

export function cloneSettings(value: AnchorSettings): AnchorSettings {
  return {
    enabled: value.enabled,
    selectedIds: [...value.selectedIds],
    prompts: value.prompts.map((prompt) => ({ ...prompt })),
    reinjectAfterCompaction: value.reinjectAfterCompaction,
    reinjectTurnInterval: value.reinjectTurnInterval,
    reinjectTokenThreshold: value.reinjectTokenThreshold,
    maxPromptChars: value.maxPromptChars,
    maxCombinedChars: value.maxCombinedChars,
    reinjectSource: value.reinjectSource,
    anchorSubagents: value.anchorSubagents,
  }
}

/** Clamp one turn interval into the accepted range, falling back on garbage. */
export function normalizeTurnInterval(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_REINJECT_TURN_INTERVAL
  return Math.min(MAX_REINJECT_TURN_INTERVAL, Math.max(0, Math.trunc(value)))
}

/**
 * Clamp one token threshold into the accepted range, falling back on garbage.
 *
 * Garbage lands on 0 rather than on a positive default: this field's default is
 * "off", and a value the plugin cannot read must never arm a trigger.
 * @param value - decoded threshold.
 * @returns the threshold to store, between 0 and {@link MAX_REINJECT_TOKEN_THRESHOLD}.
 */
export function normalizeTokenThreshold(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_REINJECT_TOKEN_THRESHOLD
  return Math.min(MAX_REINJECT_TOKEN_THRESHOLD, Math.max(0, Math.trunc(value)))
}

/** Clamp one character limit into the accepted range, falling back on garbage. */
export function normalizeTextLimit(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(MAX_TEXT_LIMIT, Math.max(MIN_TEXT_LIMIT, Math.trunc(value)))
}

/** Narrow one raw value into the accepted re-injection source. */
export function normalizeReinjectSource(value: unknown): ReinjectSource {
  return REINJECT_SOURCES.find((source) => source === value) ?? DEFAULT_REINJECT_SOURCE
}

/** Dedupe the selection, drop ids the library no longer holds, and cap its length. */
export function normalizeSelectedIds(
  ids: readonly string[],
  prompts: readonly AnchorPrompt[],
): string[] {
  const known = new Set(prompts.map((prompt) => prompt.id))
  const selected: string[] = []
  for (const id of ids) {
    if (!known.has(id) || selected.includes(id)) continue
    selected.push(id)
    if (selected.length >= MAX_SELECTED_IDS) break
  }
  return selected
}

/**
 * Combined opening prompt in selection order: each selected preset's trimmed
 * text, empty ones dropped, joined by a blank line.
 */
export function combinePromptTexts(
  prompts: readonly AnchorPrompt[],
  selectedIds: readonly string[],
): string {
  const byId = new Map(prompts.map((prompt) => [prompt.id, prompt]))
  const parts: string[] = []
  for (const id of selectedIds) {
    const text = byId.get(id)?.text.trim() ?? ''
    if (text !== '') parts.push(text)
  }
  return parts.join('\n\n')
}

/**
 * Narrow a raw Host-pushed value into AnchorSettings.
 * Returns undefined when the shape is still loading or structurally malformed.
 */
export function parseAnchorSettings(raw: unknown): AnchorSettings | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const candidate = raw as Record<string, unknown>
  const enabled = candidate[FIELD_ENABLED]
  const promptsRaw = candidate[FIELD_PROMPTS]
  if (typeof enabled !== 'boolean') return undefined
  if (!Array.isArray(promptsRaw)) return undefined
  const prompts: AnchorPrompt[] = []
  for (const item of promptsRaw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return undefined
    const prompt = item as Record<string, unknown>
    if (typeof prompt['id'] !== 'string' || prompt['id'] === '' || prompt['id'].length > MAX_PROMPT_ID_CHARS) return undefined
    if (typeof prompt['name'] !== 'string' || prompt['name'].length > MAX_PROMPT_NAME_CHARS) return undefined
    if (typeof prompt['text'] !== 'string') return undefined
    prompts.push({ id: prompt['id'], name: prompt['name'], text: prompt['text'] })
  }
  if (prompts.length > MAX_PROMPTS) return undefined

  // Selection: the ordered array wins; the retired single id stays readable so a
  // Host half or settings document from before the combination model keeps the
  // same opening prompt instead of silently falling back to the default.
  const idsRaw = candidate[FIELD_SELECTED_IDS]
  const legacyId = candidate[FIELD_SELECTED_ID_LEGACY]
  const ids: unknown = idsRaw !== undefined ? idsRaw : legacyId
  const selection = Array.isArray(ids)
    ? ids.filter((id): id is string => typeof id === 'string')
    : typeof ids === 'string' && ids !== ''
      ? [ids]
      : []
  // An absent selection means "not configured yet", which takes the default;
  // an explicit empty array is the user's 「不注入」 choice and stays empty.
  const configured = idsRaw !== undefined || typeof legacyId === 'string'
  const selectedIds = normalizeSelectedIds(
    configured ? selection : DEFAULT_ANCHOR_SETTINGS.selectedIds,
    prompts,
  )

  // Re-injection and limit fields default instead of rejecting the payload: the
  // client bundle is served over HTTP while the host half only reloads when the
  // profile restarts, so a refreshed page can meet a host that does not send
  // them yet. The reverse direction ignores unknown fields for free.
  const compaction = candidate[FIELD_REINJECT_AFTER_COMPACTION]
  const interval = candidate[FIELD_REINJECT_TURN_INTERVAL]
  const tokenThreshold = candidate[FIELD_REINJECT_TOKEN_THRESHOLD]
  const promptChars = candidate[FIELD_MAX_PROMPT_CHARS]
  const combinedChars = candidate[FIELD_MAX_COMBINED_CHARS]
  return {
    enabled,
    selectedIds,
    prompts,
    reinjectAfterCompaction:
      typeof compaction === 'boolean' ? compaction : DEFAULT_ANCHOR_SETTINGS.reinjectAfterCompaction,
    reinjectTurnInterval:
      typeof interval === 'number'
        ? normalizeTurnInterval(interval)
        : DEFAULT_ANCHOR_SETTINGS.reinjectTurnInterval,
    reinjectTokenThreshold:
      typeof tokenThreshold === 'number'
        ? normalizeTokenThreshold(tokenThreshold)
        : DEFAULT_ANCHOR_SETTINGS.reinjectTokenThreshold,
    maxPromptChars:
      typeof promptChars === 'number'
        ? normalizeTextLimit(promptChars, DEFAULT_MAX_PROMPT_CHARS)
        : DEFAULT_MAX_PROMPT_CHARS,
    maxCombinedChars:
      typeof combinedChars === 'number'
        ? normalizeTextLimit(combinedChars, DEFAULT_MAX_COMBINED_CHARS)
        : DEFAULT_MAX_COMBINED_CHARS,
    reinjectSource: normalizeReinjectSource(candidate[FIELD_REINJECT_SOURCE]),
    anchorSubagents: candidate[FIELD_ANCHOR_SUBAGENTS] === true,
  }
}
