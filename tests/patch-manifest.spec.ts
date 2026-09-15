/**
 * The bundle patch is the first thing the Harness reads out of this package, and
 * nothing else in the build or test pipeline touches it: a scoped package name
 * starts with `@`, which is a reserved YAML indicator, so an unquoted
 * `name: @scope/pkg` makes the whole profile fail to boot while typecheck, tests
 * and build all stay green. This spec is the gate for that.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const patchText = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { name: string; files: string[] }

describe('cordis.patch.yml', () => {
  it('parses as one loader patch entry', () => {
    const patch = parse(patchText) as unknown
    expect(Array.isArray(patch)).toBe(true)
    const [entry] = patch as Record<string, unknown>[]
    expect(Object.keys(entry ?? {})).toEqual(['insert'])
  })

  it('inserts this package under its own name', () => {
    const [entry] = parse(patchText) as { insert: { id: string; name: string }[] }[]
    const rows = entry?.insert ?? []
    expect(rows).toHaveLength(1)
    expect(rows[0]?.name).toBe(manifest.name)
    expect(rows[0]?.id).toBe('anchor')
  })

  it('ships the files the Harness mounts the plugin from', () => {
    expect(manifest.files).toEqual(expect.arrayContaining(['lib', 'cordis.patch.yml', 'LICENSE']))
  })
})
