/**
 * The bundle patch is the first thing the Harness reads out of this package, and
 * nothing else in the build or test pipeline touches it: a scoped package name
 * starts with `@`, which is a reserved YAML indicator, so an unquoted
 * `name: @scope/pkg` makes the whole profile fail to boot while typecheck, tests
 * and build all stay green. This spec is the gate for that.
 *
 * It is also where the entry IDENTITY is pinned, because on the 0.1.7 line the
 * entry id IS the settings namespace: the engine keys a form by
 * `entry.options.id`, the browser half reads that same key, and the one-shot
 * import of a retired `settings.yaml` writes a section into "the entry of the
 * same id" — so an id that drifts from {{@link NS}} silently detaches this
 * plugin from the settings document it has always owned (the `dsh-anchor:`
 * section, where the company `company-onboarding` preset lives).
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { INJECTION_SOURCE_KIND, NS } from '../src/types/anchor-settings.ts'

const patchText = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { name: string; files: string[]; version: string; peerDependencies: Record<string, string> }

describe('cordis.patch.yml', () => {
  it('parses as one loader patch entry', () => {
    const patch = parse(patchText) as unknown
    expect(Array.isArray(patch)).toBe(true)
    const [entry] = patch as Record<string, unknown>[]
    expect(Object.keys(entry ?? {})).toEqual(['insert'])
  })

  it('inserts this package under its own name, at the plugin’s own namespace', () => {
    const [entry] = parse(patchText) as { insert: { id: string; name: string }[] }[]
    const rows = entry?.insert ?? []
    expect(rows).toHaveLength(1)
    expect(rows[0]?.name).toBe(manifest.name)
    expect(rows[0]?.id).toBe(NS)
  })

  it('ships the files the Harness mounts the plugin from', () => {
    expect(manifest.files).toEqual(expect.arrayContaining(['lib', 'cordis.patch.yml', 'LICENSE']))
  })
})

describe('the identity the document hangs on', () => {
  it('names the injection source after the plugin, as the format migration does', () => {
    // `dsh-session-format-v3-to-v4` rewrites `{kind:'plugin',plugin:<NS>}` to
    // `plugin:<NS>`; writing the same string is what makes an injection written
    // before the upgrade and one written after it indistinguishable.
    expect(INJECTION_SOURCE_KIND).toBe(`plugin:${NS}`)
  })

  it('declares the peer line it was adapted to', () => {
    // The line change is the point of the release: a peer range that still
    // admits the previous line would let the bundle mount where its settings
    // model does not exist.
    // 2026-09-25 创始人口径：写成 `>=0.1.7-rc.1`（**不再兼容旧版**）—— 本断言只放行
    // 「`^0.1.7…`」与「`>=0.1.7-rc.1`」两种形状，并**显式拒绝**任何把 0.1.6 线写进范围的写法。
    for (const [name, range] of Object.entries(manifest.peerDependencies)) {
      if (!range.includes('0.1.')) continue
      expect(
        /^(?:\^0\.1\.7|>=0\.1\.7-rc\.1)/.test(range),
        `${name} 的 peer 必须只指向 0.1.7 线，实际是 ${range}`,
      ).toBe(true)
      expect(range.includes('0.1.6'), `${name} 不许兼容 0.1.6 线，实际是 ${range}`).toBe(false)
    }
  })
})
