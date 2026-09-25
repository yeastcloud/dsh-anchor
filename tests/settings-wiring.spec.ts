/**
 * Host-half settings wiring, on both lines.
 *
 * The 0.1.7 line replaced the section registry with a page policy: the form IS
 * the plugin's own `Config`, `ctx.settings.configure()` only registers how it
 * should be presented, and every field arrives as a live accessor
 * (`config.<field>.get()`) instead of a plain value. None of that is visible to
 * the `installSection` stub the behaviour suite mounts, so this spec drives the
 * other branch directly — and asserts the two shapes of "read one Config field"
 * answer the same thing, because that is the assumption the whole host half
 * rests on.
 */

import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply, readAnchorSettings } from '../src/index.ts'
import {
  DEFAULT_ANCHOR_SETTINGS,
  FIELD_ENABLED,
  FIELD_MAX_COMBINED_CHARS,
  FIELD_PROMPTS,
  FIELD_SELECTED_IDS,
  cloneSettings,
  type AnchorSettings,
} from '../src/types/anchor-settings.ts'

interface Wiring {
  /** Policies registered through `settings.configure(...)`. */
  configured: { presentation: { auto?: boolean }; owner: unknown }[]
  /** Effects the plugin registered on the injected child context. */
  effects: (() => unknown)[]
}

/**
 * Mount the plugin against a 0.1.7-shaped context: `settings.configure` exists,
 * `installSection` does not, and the Config arrives as live accessors.
 * @param config - field accessors or plain values, as the loader (or a test) hands them over.
 * @returns what the plugin registered, for the assertions below.
 */
function mount(config: Record<string, unknown>): Wiring {
  const wiring: Wiring = { configured: [], effects: [] }
  const forms = {
    configure: (presentation: { auto?: boolean }, owner?: unknown) => {
      wiring.configured.push({ presentation, owner })
      return () => {}
    },
  }
  const child = {
    settings: forms,
    effect: (execute: () => unknown) => {
      wiring.effects.push(execute)
      return () => {}
    },
  }
  const ctx = {
    fiber: { uid: 7 },
    logger: { warn: () => {} },
    // `settings` has `configure` and no `installSection`: exactly the 0.1.7 surface.
    get: (name: string) => (name === 'settings' ? forms : undefined),
    inject: (names: readonly string[], callback: (scoped: unknown) => void) => {
      if (names.includes('settings')) callback(child)
    },
    on: () => {},
  }
  apply(ctx as unknown as Context, config, { env: {} })
  return wiring
}

/** One Config field as the 0.1.7 loader resolves it: a live accessor. */
const accessor = <T>(value: T) => ({ get: () => value })

const CUSTOM: AnchorSettings = {
  ...DEFAULT_ANCHOR_SETTINGS,
  selectedIds: ['onboarding'],
  prompts: [{ id: 'onboarding', name: '开工', text: '开工锚：先读规矩。' }],
}

describe('the 0.1.7 page policy', () => {
  it('registers the policy as an effect of an injected settings child', () => {
    const wiring = mount({})
    // Deferred, like every cordis effect: nothing is registered until the child
    // context activates, which is what keeps a late settings service working.
    expect(wiring.effects).toHaveLength(1)
    expect(wiring.configured).toEqual([])

    wiring.effects[0]?.()
    expect(wiring.configured).toEqual([{ presentation: { auto: false }, owner: { uid: 7 } }])
  })

  it('loads without any settings service at all', () => {
    const ctx = {
      fiber: {},
      logger: { warn: () => {} },
      get: () => undefined,
      inject: (names: readonly string[], callback: (scoped: unknown) => void) => {
        if (names.includes('settings')) callback({ settings: {}, effect: () => () => {} })
      },
      on: () => {},
    }
    expect(() => {
      apply(ctx as unknown as Context, undefined, { env: {} })
    }).not.toThrow()
  })

  it('never calls installSection when the line offers configure', () => {
    // A `installSection` that fails the test if reached: on 0.1.7 calling the
    // removed API is what takes the whole plugin tree down with it.
    const ctx = {
      fiber: {},
      logger: { warn: () => {} },
      get: () => ({
        configure: () => () => {},
        installSection: () => {
          throw new Error('installSection must not be called on the 0.1.7 line')
        },
      }),
      inject: (names: readonly string[], callback: (scoped: unknown) => void) => {
        if (names.includes('settings')) {
          callback({ settings: { configure: () => () => {} }, effect: () => () => {} })
        }
      },
      on: () => {},
    }
    expect(() => {
      apply(ctx as unknown as Context, undefined, { env: {} })
    }).not.toThrow()
  })
})

describe('readAnchorSettings', () => {
  it('reads live accessors and plain values to the same settings', () => {
    const live = {
      [FIELD_ENABLED]: accessor(false),
      [FIELD_SELECTED_IDS]: accessor(['onboarding']),
      [FIELD_PROMPTS]: accessor(CUSTOM.prompts),
    }
    const plain = {
      [FIELD_ENABLED]: false,
      [FIELD_SELECTED_IDS]: ['onboarding'],
      [FIELD_PROMPTS]: CUSTOM.prompts,
    }
    expect(readAnchorSettings(live)).toEqual(readAnchorSettings(plain))
    expect(readAnchorSettings(live).selectedIds).toEqual(['onboarding'])
  })

  it('fills the fields an absent config does not carry', () => {
    expect(readAnchorSettings(undefined)).toEqual(DEFAULT_ANCHOR_SETTINGS)
    expect(readAnchorSettings({})).toEqual(DEFAULT_ANCHOR_SETTINGS)
    expect(readAnchorSettings({ [FIELD_ENABLED]: false })).toEqual({
      ...DEFAULT_ANCHOR_SETTINGS,
      enabled: false,
    })
  })

  it('takes a present field as the loader validated it, without a second opinion', () => {
    // The values reaching `apply` were already validated against `Config`, so the
    // read must not re-clamp them: a second authority here could silently change
    // what the user stored. Only ABSENT fields fall back.
    expect(readAnchorSettings({ [FIELD_SELECTED_IDS]: [] }).selectedIds).toEqual([])
    const narrow = readAnchorSettings({ [FIELD_MAX_COMBINED_CHARS]: 3 })
    expect(narrow.maxCombinedChars).toBe(3)
    expect(narrow.enabled).toBe(DEFAULT_ANCHOR_SETTINGS.enabled)
  })

  it('re-reads an accessor on every call, so an edit reaches a running session', () => {
    let current = cloneSettings(DEFAULT_ANCHOR_SETTINGS)
    const config = {
      [FIELD_PROMPTS]: { get: () => current.prompts },
      [FIELD_SELECTED_IDS]: { get: () => current.selectedIds },
      [FIELD_ENABLED]: { get: () => current.enabled },
    }
    expect(readAnchorSettings(config).selectedIds).toEqual(DEFAULT_ANCHOR_SETTINGS.selectedIds)
    current = cloneSettings(CUSTOM)
    expect(readAnchorSettings(config).selectedIds).toEqual(['onboarding'])
  })
})
