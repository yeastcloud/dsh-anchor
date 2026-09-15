/**
 * `/anchor` command behaviour.
 *
 * The command contract runs a handler locally against the receiving agent, so
 * anchoring costs no model call and opens no turn. What matters here is that the
 * handler injects exactly one plugin-sourced message (which is what makes the
 * injection recognizable in the durable log afterwards), and that every refusal
 * path refuses instead of injecting something approximate.
 *
 * Command output is localized from the Host environment, and the harness injects
 * that environment through `apply`'s third argument: the assertions therefore
 * never depend on the locale of the machine running the suite (an unset one
 * resolves to zh, which is the default this mount uses).
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
  /** Everything the handler queued, as `[target, message]` pairs. */
  queued: { target: string; message: Injection }[]
  /** Run the handler as the registry would, against one stub agent. */
  run: (rawInput?: string) => unknown
  setSettings: (patch: Partial<AnchorSettings>) => void
  setLog: (events: { type: string; seq: number; data: unknown }[]) => void
  /** The command description this mount registered (locale-dependent). */
  description: string | undefined
}

const PROMPTS = [
  { id: 'a', name: '甲预设', text: '甲' },
  { id: 'b', name: '乙预设', text: '乙' },
]

function mount(
  initial: Partial<AnchorSettings> = {},
  env: Record<string, string | undefined> = {},
): Harness {
  let current: AnchorSettings = {
    ...DEFAULT_ANCHOR_SETTINGS,
    selectedIds: ['a'],
    prompts: PROMPTS,
    ...initial,
  }
  let log: { type: string; seq: number; data: unknown }[] = []
  let nextTurn: Injection[] = []
  let nextStep: Injection[] = []
  const queued: { target: string; message: Injection }[] = []
  let command: CommandDefinition | undefined

  // Mirrors the real agent: pending input lives in two inbox queues, and a queued
  // anchor is the only place a not-yet-claimed injection is visible.
  const agent = {
    session: { snapshotEvents: () => log },
    inbox: {
      get nextTurn() {
        return nextTurn
      },
      get nextStep() {
        return nextStep
      },
      append: (target: string, message: unknown) => {
        queued.push({ target, message: message as Injection })
        if (target === 'next-turn') nextTurn = [...nextTurn, message as Injection]
        else nextStep = [...nextStep, message as Injection]
      },
    },
    inject: (message: unknown) => {
      queued.push({ target: 'inject:next-step', message: message as Injection })
      nextStep = [...nextStep, message as Injection]
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

  apply(ctx as unknown as Context, undefined, { env })
  return {
    command,
    description: command?.description,
    queued,
    run: (rawInput = '') => command?.handler({ agent, rawInput, commandId: 'c1', attachments: [], signal: new AbortController().signal }),
    setSettings: (patch) => {
      current = { ...current, ...patch }
    },
    setLog: (events) => {
      log = events
    },
  }
}

const queuedText = (harness: Harness): string | undefined => harness.queued[0]?.message.content?.[0]?.text
const resultOf = (value: unknown): { kind: string; text?: string } => value as { kind: string; text?: string }

describe('/anchor', () => {
  it('registers one lowercase command with a description', () => {
    const harness = mount()
    expect(harness.command?.name).toBe('anchor')
    expect(harness.command?.description.length).toBeGreaterThan(0)
  })

  // The description is registered once, from the same environment-injected
  // locale as every handler reply.
  it('describes itself in the locale the environment names', () => {
    expect(mount().description).toContain('定锚')
    const english = mount({}, { LC_ALL: 'en_US.UTF-8' })
    expect(english.description).toContain('Anchor')
    expect(english.description).not.toContain('定锚')
  })

  // A next-step anchor is claimed by whatever turn is running, which silently adds
  // a model step to work already in flight; only the next-turn queue may be used.
  it('queues the anchor for the next turn, never for the next step', () => {
    const harness = mount()
    harness.run()
    expect(harness.queued.map((entry) => entry.target)).toEqual(['next-turn'])
  })

  it('queues the current combination as one plugin-sourced message', () => {
    const harness = mount({ selectedIds: ['b', 'a'] })
    const result = resultOf(harness.run())
    expect(result.kind).toBe('success')
    expect(result.text).toContain('已定锚')
    expect(harness.queued).toHaveLength(1)
    expect(queuedText(harness)).toBe('乙\n\n甲')
    expect(harness.queued[0]?.message.source?.plugin).toBe(pluginName)
  })

  // Same run, two environments: the anchored TEXT is the user's own and never
  // translated, while the report around it follows LC_ALL/LANG.
  it('writes its success text in the locale the environment names', () => {
    const chinese = mount({ selectedIds: ['b', 'a'] })
    const chineseResult = resultOf(chinese.run())
    expect(chineseResult.text).toContain('已定锚：4 字 · 2 段（乙预设 → 甲预设）')
    expect(chineseResult.text).toContain('此后本会话的压缩/轮数重锚都会复用这段原文。')

    const english = mount({ selectedIds: ['b', 'a'] }, { LC_ALL: 'en_US.UTF-8' })
    const englishResult = resultOf(english.run())
    expect(englishResult.kind).toBe('success')
    expect(englishResult.text).toContain('Anchored: 4 char(s) · 2 preset(s) (乙预设 → 甲预设)')
    expect(englishResult.text).toContain('Takes effect at the next turn boundary')
    expect(englishResult.text).not.toContain('已定锚')
    expect(queuedText(english)).toBe('乙\n\n甲')

    const french = mount({ selectedIds: ['b', 'a'] }, { LANG: 'fr_FR.UTF-8' })
    expect(resultOf(french.run()).text).toContain('已定锚')
  })

  it('does not queue the same combination twice', () => {
    const harness = mount()
    harness.run()
    const second = resultOf(harness.run())
    expect(harness.queued).toHaveLength(1)
    expect(second.text).toContain('没有重复注入')
  })

  it('reports a queued anchor instead of contradicting /anchor', () => {
    const harness = mount()
    harness.run()
    const result = resultOf(harness.run('status'))
    expect(result.kind).toBe('success')
    expect(result.text).toContain('已排队：1 条')
    expect(result.text).toContain('还没有已落地的注入')
    expect(result.text).not.toContain('尚无注入')
  })

  it('refuses instead of injecting when the switch is off', () => {
    const harness = mount({ enabled: false })
    const result = resultOf(harness.run())
    expect(result.kind).toBe('error')
    expect(result.text).toContain('总开关')
    expect(harness.queued).toHaveLength(0)
  })

  it('refuses in English too, keeping the usage line', () => {
    const harness = mount({ enabled: false }, { LC_ALL: 'en_US.UTF-8' })
    const result = resultOf(harness.run())
    expect(result.kind).toBe('error')
    expect(result.text).toContain('The anchor master switch is off')
    expect(result.text).toContain('`/anchor status` only reports state and injects nothing.')
    expect(harness.queued).toHaveLength(0)
  })

  it('refuses when the combination is empty', () => {
    const harness = mount({ selectedIds: [] })
    const result = resultOf(harness.run())
    expect(result.kind).toBe('error')
    expect(result.text).toContain('组合为空')
    expect(harness.queued).toHaveLength(0)
  })

  it('refuses when the combination exceeds the combined limit', () => {
    const harness = mount({ selectedIds: ['a', 'b'], maxCombinedChars: 2 })
    const result = resultOf(harness.run())
    expect(result.kind).toBe('error')
    expect(result.text).toContain('超过合并上限')
    expect(harness.queued).toHaveLength(0)
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
    expect(harness.queued).toHaveLength(0)
  })

  it('reports status in English for an English environment', () => {
    const harness = mount({ reinjectSource: 'latest', reinjectTurnInterval: 7 }, { LC_ALL: 'en_US.UTF-8' })
    const result = resultOf(harness.run('status'))
    expect(result.kind).toBe('success')
    expect(result.text).toContain('⚓ Anchor status')
    expect(result.text).toContain('Master switch: on | Combination: 甲预设 (1 char(s) / limit 8000)')
    expect(result.text).toContain('Re-anchor: the latest injection this plugin made | Turn interval: 7 turns | After compaction: yes')
    expect(result.text).toContain('This session: no injection yet')
    expect(result.text).not.toContain('定锚')
  })

  it('rejects an unknown argument with the usage line', () => {
    const harness = mount()
    const result = resultOf(harness.run('now please'))
    expect(result.kind).toBe('error')
    expect(result.text).toContain('/anchor status')
    expect(harness.queued).toHaveLength(0)
  })
})
