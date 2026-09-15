/**
 * Copy-table invariants, the translator, and the Host-side locale resolution.
 *
 * The client half registers the table as one locale namespace, so a key that
 * exists in only one language renders the other language's text (or the raw
 * key), and a placeholder that exists in only one language silently drops a
 * value. Both are checked here; the second is a hard invariant of
 * `{name}`-style formatting, which is what every count and name in this plugin
 * rides. `pickHostLocale` is the Host half's only locale source — the browser
 * preference is unavailable there — so its tag matching is asserted directly.
 */

import { describe, expect, it } from 'vitest'
import { ANCHOR_COPY, ANCHOR_LOCALES, translate, type AnchorCopyKey } from '../src/copy.ts'
import { pickHostLocale } from '../src/index.ts'

/** `{name}` placeholders of one template, order-insensitive. */
function placeholders(template: string): string[] {
  return [...template.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => match[1] ?? '').sort()
}

const KEYS = Object.keys(ANCHOR_COPY.zh) as AnchorCopyKey[]

describe('copy table', () => {
  it('carries the same key set in every locale', () => {
    expect(ANCHOR_LOCALES).toContain('zh')
    expect(KEYS.length).toBeGreaterThan(0)
    for (const locale of ANCHOR_LOCALES) {
      expect(Object.keys(ANCHOR_COPY[locale]).sort()).toEqual([...KEYS].sort())
    }
  })

  it('leaves no empty or whitespace-only value', () => {
    for (const locale of ANCHOR_LOCALES) {
      for (const key of KEYS) {
        expect(ANCHOR_COPY[locale][key].trim(), `${locale}.${key}`).not.toBe('')
      }
    }
  })

  it('uses the same placeholder set for a key in every locale', () => {
    for (const key of KEYS) {
      const expected = placeholders(ANCHOR_COPY.zh[key])
      for (const locale of ANCHOR_LOCALES) {
        expect(placeholders(ANCHOR_COPY[locale][key]), `${locale}.${key}`).toEqual(expected)
      }
    }
  })
})

describe('translate', () => {
  it('interpolates {name} placeholders', () => {
    expect(translate('en', 'pageStatus', { page: 2, pages: 3, total: 7 }))
      .toBe('Page 2 / 3 · 7 preset(s)')
    expect(translate('zh', 'charCount', { used: 12, max: 8000 })).toBe('12 / 8000 字')
  })

  it('falls back to English for a locale this plugin does not ship', () => {
    expect(translate('de', 'nav')).toBe(ANCHOR_COPY.en.nav)
    expect(translate('zh-extra', 'deleteConfirm', { name: 'A' })).toBe('Delete preset "A"?')
  })

  it('leaves a placeholder without a value verbatim', () => {
    expect(translate('zh', 'saveFailed')).toBe('保存失败：{message}')
    expect(translate('zh', 'pageStatus', { page: 1, pages: 1 })).toContain('{total}')
  })
})

describe('pickHostLocale', () => {
  it('reads the leading tag of LC_ALL', () => {
    expect(pickHostLocale({ LC_ALL: 'en_US.UTF-8' })).toBe('en')
    expect(pickHostLocale({ LC_ALL: 'zh_CN.UTF-8' })).toBe('zh')
    expect(pickHostLocale({ LC_ALL: 'en' })).toBe('en')
    expect(pickHostLocale({ LC_ALL: 'EN_us' })).toBe('en')
  })

  it('falls back to LANG, with LC_ALL winning over it', () => {
    expect(pickHostLocale({ LANG: 'en_GB.UTF-8' })).toBe('en')
    expect(pickHostLocale({ LANG: 'zh_CN.UTF-8' })).toBe('zh')
    expect(pickHostLocale({ LC_ALL: 'zh_CN.UTF-8', LANG: 'en_US.UTF-8' })).toBe('zh')
  })

  it('answers zh when nothing is set or nothing is recognised', () => {
    expect(pickHostLocale({})).toBe('zh')
    expect(pickHostLocale({ LANG: 'fr_FR.UTF-8' })).toBe('zh')
    expect(pickHostLocale({ LC_ALL: 'C' })).toBe('zh')
    expect(pickHostLocale({ LC_ALL: '' })).toBe('zh')
  })
})
