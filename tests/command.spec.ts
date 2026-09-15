/**
 * `/anchor` command behaviour.
 *
 * The command contract runs a handler locally against the receiving agent, so
 * anchoring costs no model call and opens no turn. What matters here is that the
 * handler injects exactly one plugin-sourced message (which is what makes the
 * injection recognizable in the durable log afterwards), and that every refusal
 * path refuses instead of injecting something approximate.
 */

import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply, name as pluginName } from '../src/index.ts'
import { DEFAULT_ANCHOR_SETTINGS, type AnchorSettings } from '../src/types/anchor-settings.ts'

interface CommandDefinition {
  name: string
  description: string
  handler: (invocation: unknown) => unknown
}

interface Injection {
  content?: { type?: string; text?: string }[]
  source?: { kind?: string; plugin?: string }
}

interface Harness {
  /** The definition the plugin registered, if it registered one. */
  command: CommandDefinition | undefined
  /** Everything the handler handed to `agent.inject`. */
  injected: Injection[]
  /** Run the handler as the registry would, against one stub agent. */
  run: (rawInput?: string) => unknown
  setSettings: (patch: Partial<AnchorSettings>) => void
  setLog: (events: { type: string; seq: number; data: unknown }[]) => void
}

const PROMPTS = [
  { id: 'a', name: '甲预设', text: '甲' },
  { id: 'b', name: '乙预设', text: '乙' },
]

function mount(initial: Partial<AnchorSettings> = {}): Harness {
  let current: AnchorSettings = {
    ...DEFAULT_ANCHOR_SETTINGS,
    selectedIds: ['a'],
    prompts: PROMPTS,
    ...initial,
  }
  let log: { type: string; seq: number; data: unknown }[] = []
  const injected: Injection[] = []
  let command: CommandDefinition | undefined

  const agent = {
    session: { snapshotEvents: () => log },
    inject: (message: unknown) => {
      injected.push(message as Injection)
    },
  }
  const ctx = {
    settings: {
      installSection: (
        _ctx: unknown,
        _ns: unknown,
        _schema: unknown,
        _defaults: unknown,
        options: { setSource: (source: () => AnchorSettings) => void },
      ) => {
        options.setSource(() => current)
      },
    },
    logger: { warn: () => {} },
    on: () => {},
    inject: (names: readonly string[], callback: (scoped: unknown) => void) => {
      if (names.includes('commands')) {
        callback({ commands: { register: (definition: CommandDefinition) => { command = definition } } })
      }
    },
  }

  apply(ctx as unknown as Context)
  return {
    command,
    injected,
    run: (rawInput = '') => command?.handler({ agent, rawInput, commandId: 'c1', attachments: [], signal: new AbortController().signal }),
    setSettings: (patch) => {
      current = { ...current, ...patch }
    },
    setLog: (events) => {
      log = events
    },
  }
}

const injectedText = (harness: Harness): string | undefined => harness.injected[0]?.content?.[0]?.text
const resultOf = (value: unknown): { kind: string; text?: string } => value as { kind: string; text?: string }

describe('/anchor', () => {
  it('registers one lowercase command with a description', () => {
    const harness = mount()
    expect(harness.command?.name).toBe('anchor')
    expect(harness.command?.description.length).toBeGreaterThan(0)
  })

  it('injects the current combination as one plugin-sourced message', () => {
    const harness = mount({ selectedIds: ['b', 'a'] })
    const result = resultOf(harness.run())
    expect(result.kind).toBe('success')
    expect(result.text).toContain('已定锚')
    expect(harness.injected).toHaveLength(1)
    expect(injectedText(harness)).toBe('乙\n\n甲')
    expect(harness.injected[0]?.source?.plugin).toBe(pluginName)
  })

  it('refuses instead of injecting when the switch is off', () => {
    const harness = mount({ enabled: false })
    const result = resultOf(harness.run())
    expect(result.kind).toBe('error')
    expect(result.text).toContain('总开关')
    expect(harness.injected).toHaveLength(0)
  })

  it('refuses when the combination is empty', () => {
    const harness = mount({ selectedIds: [] })
    const result = resultOf(harness.run())
    expect(result.kind).toBe('error')
    expect(result.text).toContain('组合为空')
    expect(harness.injected).toHaveLength(0)
  })

  it('refuses when the combination exceeds the combined limit', () => {
    const harness = mount({ selectedIds: ['a', 'b'], maxCombinedChars: 2 })
    const result = resultOf(harness.run())
    expect(result.kind).toBe('error')
    expect(result.text).toContain('超过合并上限')
    expect(harness.injected).toHaveLength(0)
  })

  it('reports status without injecting anything', () => {
    const harness = mount({ reinjectSource: 'latest', reinjectTurnInterval: 7 })
    harness.setLog([
      {
        type: 'user/message',
        seq: 3,
        data: { content: [{ type: 'text', text: '甲' }], source: { kind: 'plugin', plugin: pluginName } },
      },
      { type: 'turn/start', seq: 4, data: {} },
    ])
    const result = resultOf(harness.run('status'))
    expect(result.kind).toBe('success')
    expect(result.text).toContain('定锚状态')
    expect(result.text).toContain('最近一条本插件注入')
    expect(result.text).toContain('seq 3')
    expect(result.text).toContain('1 轮')
    expect(harness.injected).toHaveLength(0)
  })

  it('rejects an unknown argument with the usage line', () => {
    const harness = mount()
    const result = resultOf(harness.run('now please'))
    expect(result.kind).toBe('error')
    expect(result.text).toContain('/anchor status')
    expect(harness.injected).toHaveLength(0)
  })
})
