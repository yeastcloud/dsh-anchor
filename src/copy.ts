/**
 * User-facing copy for @yeastcloud/dsh-anchor, in one table both halves share.
 *
 * The browser half registers the table as the `settings.anchor` locale
 * namespace, so the settings page and its left-nav entry follow the DSH locale
 * (zh/en). The Host half has no locale service: `/anchor` output and the
 * over-limit warning resolve their locale from `LC_ALL`/`LANG` instead (see
 * `pickHostLocale` in `./index.ts`), and format through the same
 * {@link translate}.
 *
 * `zh` is the source of truth for the key set — `AnchorCopyKey` is derived from
 * it, so a key that exists in only one language is a compile error on `en`.
 */

/** Locales this plugin ships copy for. */
export const ANCHOR_LOCALES = ['zh', 'en'] as const

/** One locale this plugin ships copy for. */
export type AnchorLocale = (typeof ANCHOR_LOCALES)[number]

/** Values interpolated into a copy template's `{name}` placeholders. */
export type CopyVars = Readonly<Record<string, string | number>>

const zh = {
  // Left-nav entry and page heading.
  nav: '定锚',
  title: '定锚 · 会话指令注入',
  introLead: '给每个新会话',
  introAnchor: '定锚',
  introMid: '：把勾选的预设按下面的顺序拼成一段指令注入； 会话被压缩或过长后会',
  introReanchor: '重锚',
  introTail: '同一段原文。关闭总开关则暂停全部注入。',
  reset: '恢复默认',
  resetConfirm: '恢复为默认设置？当前预设、组合与重锚策略都会被覆盖。',

  // Master switch and re-anchor policy.
  enabledTitle: '启用注入',
  enabledDescription: '总开关：关闭后定锚与重锚全部停止，设置与组合保留。',
  reinjectTitle: '压缩后自动重锚',
  reinjectDescription: '会话被压缩（自动触发或 /compact）后，在下一次模型请求前把锚文原样重锚一次。',
  turnIntervalTitle: '按轮数重锚',
  turnIntervalDescription: '距上次定锚满 N 轮后，在下一轮开始时再重锚一次；填 0 关闭。',
  turnIntervalAria: '重锚轮数间隔',
  reinjectSourceTitle: '重锚取哪一条',
  reinjectSourceDescription:
    '重锚重复哪一条：「定锚原文」= 永远重复会话开头那条；「最近一条」= 重复本插件最近一次注入 （用 `/anchor` 定锚的那条也在此列，等于在本会话把人设换掉）。',
  reinjectSourceAria: '重锚来源',
  reinjectFirst: '定锚原文',
  reinjectLatest: '最近一条',
  maxPromptTitle: '单条上限',
  maxPromptDescription: '编辑器里单条预设最多可输入的字数。已存在的长预设不会被自动截断。',
  maxPromptAria: '单条上限字数',
  maxCombinedTitle: '合并上限',
  maxCombinedDescription: '组合拼接后的总字数上限；超限则定锚与重锚都不注入，并写入日志。',
  maxCombinedAria: '合并上限字数',
  hintLead: '重锚重复的是上面「重锚取哪一条」选定的那一条：选',
  hintFirst: '「定锚原文」',
  hintMid: '时永远是本次会话开头那段 （从会话记录里取回，改组合只影响下一个新会话）；选',
  hintLatest: '「最近一条」',
  hintTail: '时是本插件最近一次注入—— 用 /anchor 把改好的组合定进来，就会在本次会话内换掉重锚内容。',

  // Save/report lines.
  loading: '正在读取设置…',
  readOnly: '设置存储不可写：本次修改只在当前页面内生效。',
  saveFailed: '保存失败：{message}',
  saving: '正在保存…',

  // Adding and editing one preset.
  newNamePlaceholder: '预设名称，例如：中文简洁',
  newNameAria: '新预设名称',
  newTextPlaceholder: '注入给模型的提示词正文，例如：请用中文回答，所有代码先给最小可运行版本。',
  newTextAria: '新预设内容',
  charCount: '{used} / {max} 字',
  add: '添加',
  cancel: '取消',
  editNameAria: '预设名称',
  editTextAria: '预设内容',
  save: '保存',
  unnamedPreset: '未命名提示词',

  // The preset library.
  noneAria: '不注入任何内容',
  noneName: '不注入',
  noneDescription: '新会话不定锚（已有会话的压缩/轮数重锚不受影响）。选它会清空下面的组合。',
  selected: '已选',
  emptyLibrary: '还没有预设。点击「＋ 新增预设」创建第一条。',
  joinAria: '把预设「{name}」加入定锚组合',
  inCombination: '已加入组合',
  overCap: '超出单条上限',
  emptyText: '空内容（不会被注入）',
  edit: '编辑',
  deleteConfirm: '删除预设「{name}」？',
  delete: '删除',
  previousPage: '‹ 上一页',
  pageStatus: '第 {page} / {pages} 页 · 共 {total} 条',
  nextPage: '下一页 ›',
  pageSizeLabel: '每页',
  pageSizeAria: '每页预设条数',
  addPreset: '＋ 新增预设',

  // The injection order.
  orderTitle: '注入顺序',
  orderHint: '拖拽或用 ↑ ↓ 调整；这里的顺序就是拼接顺序',
  orderEmpty: '还没选任何预设：勾选上方预设后，它们会按这里的顺序拼成锚文。当前状态为「不注入」，新会话不会收到定锚。',
  orderEmptyPreview: '（空内容）',
  moveUpAria: '把「{name}」上移',
  moveDownAria: '把「{name}」下移',
  removeAria: '把「{name}」移出组合',
  totalChars: '合计 {used} / {max} 字',
  overLimitSuffix: ' —— 超限：不会注入，请精简组合或调高合并上限',
  previewSummary: '合并文本预览',

  // `/anchor` output and the Host log line.
  'command.description': '定锚：把当前组合注入本会话（不发消息、不触发模型回复）',
  'command.usage': '用法：`/anchor` 立即定锚当前组合；`/anchor status` 只看状态、不注入。',
  'command.combinationEmpty': '（当前为「不注入」）',
  'command.statusTitle': '⚓ 定锚状态',
  'command.stateOn': '开',
  'command.stateOff': '关',
  'command.statusSwitch': '总开关：{state} ｜ 组合：{combination}（{chars} 字 / 上限 {max}）',
  'command.statusReinject': '重锚：{source} ｜ 轮数间隔：{interval} ｜ 压缩后：{afterCompaction}',
  'command.reinjectSourceLatest': '最近一条本插件注入',
  'command.reinjectSourceFirst': '定锚原文',
  'command.intervalOff': '关闭',
  'command.intervalTurns': '{turns} 轮',
  'command.afterCompactionYes': '补',
  'command.afterCompactionNo': '不补',
  'command.queuedTurn': '已排队：{count} 条（{chars} 字），等下一个回合边界落进日志',
  'command.queuedStep': '另有 {count} 条排在下一个 step 边界',
  'command.noInjectionYetQueued': '本会话日志：还没有已落地的注入（上面那条落地后会成为首条基线）',
  'command.noInjectionYet': '本会话：尚无注入（下一条消息的第一个 step 会定锚）',
  'command.firstInjection': '本会话首条注入：seq {seq}（{chars} 字）',
  'command.latestInjection': '最近一次注入：seq {seq}（{chars} 字）',
  'command.turnsSince': '距上次注入：{turns} 轮',
  'command.compactedSince': '，且之后发生过压缩',
  'command.switchOff': '定锚总开关已关闭（设置 → 定锚）。{usage}',
  'command.emptyCombination': '当前组合为空（「不注入」），没有可注入的内容。{usage}',
  'command.overLimit': '组合 {chars} 字，超过合并上限 {max} 字，未注入。',
  'command.duplicate': '⚓ 已有一条同样的组合在排队（等下一个回合边界落进日志），没有重复注入。',
  'command.anchored':
    '⚓ 已定锚：{chars} 字 · {segments} 段（{combination}）\n生效：下一个回合边界——正在跑的回合照旧跑完，不会被延长；也不唤醒驱动。\n此后本会话的压缩/轮数重锚都会复用这段原文。',
  'log.overLimit': '定锚注入已跳过：开启提示词 {chars} 字，超过配置的 {max} 字上限',
}

/** Every copy key of this plugin; `zh` is the key-set source of truth. */
export type AnchorCopyKey = keyof typeof zh

const en: Readonly<Record<AnchorCopyKey, string>> = {
  nav: 'Anchor',
  title: 'Anchor · Session instruction injection',
  // The `{strong}` terms are their own keys because the page renders each one
  // inside its own <strong>; the surrounding spaces live in the neighbours.
  introLead: 'Give every new session ',
  introAnchor: 'an anchor',
  introMid:
    ': the checked presets are concatenated in the order below into one injected instruction; once the session is compacted or grows too long it is ',
  introReanchor: 're-anchored',
  introTail: ' onto the same original text. Turning the master switch off pauses all injection.',
  reset: 'Restore defaults',
  resetConfirm:
    'Restore the default settings? The current presets, combination and re-anchoring policy will all be overwritten.',

  enabledTitle: 'Injection enabled',
  enabledDescription:
    'Master switch: turning it off stops both anchoring and re-anchoring; the settings and the combination are kept.',
  reinjectTitle: 'Re-anchor after compaction',
  reinjectDescription:
    'After the session is compacted (automatically or by /compact), re-anchor the same text once, right before the next model request.',
  turnIntervalTitle: 'Re-anchor by turn count',
  turnIntervalDescription:
    'Once N turns have passed since the last anchor, re-anchor at the start of the next turn; 0 turns it off.',
  turnIntervalAria: 'Re-anchor turn interval',
  reinjectSourceTitle: 'Which injection is re-anchored',
  reinjectSourceDescription:
    'Which injection a re-anchor repeats: "the original anchor" always repeats the one at the start of the session; "the latest one" repeats the most recent injection this plugin made (an anchor placed with `/anchor` counts too, which switches the persona inside this session).',
  reinjectSourceAria: 'Re-anchor source',
  reinjectFirst: 'Original anchor',
  reinjectLatest: 'Latest injection',
  maxPromptTitle: 'Per-preset limit',
  maxPromptDescription:
    'Maximum number of characters one preset may hold in the editor. Existing longer presets are never truncated automatically.',
  maxPromptAria: 'Per-preset character limit',
  maxCombinedTitle: 'Combined limit',
  maxCombinedDescription:
    'Maximum total characters of the concatenated combination; above it neither anchoring nor re-anchoring injects anything, and a line is written to the log.',
  maxCombinedAria: 'Combined character limit',
  hintLead: 'The re-anchor repeats whichever injection "which injection is re-anchored" selects: with ',
  hintFirst: '"the original anchor"',
  hintMid:
    ' it is always the opening text of this session (read back from the session log, so editing the combination only affects the next new session); with ',
  hintLatest: '"the latest one"',
  hintTail:
    ' it is the most recent injection this plugin made — send the edited combination with /anchor and the re-anchored text changes inside this session.',

  loading: 'Reading settings…',
  readOnly: 'The settings store is not writable: changes apply to this page only.',
  saveFailed: 'Save failed: {message}',
  saving: 'Saving…',

  newNamePlaceholder: 'Preset name, for example: concise Chinese',
  newNameAria: 'New preset name',
  newTextPlaceholder:
    'Prompt text injected into the model, for example: answer in Chinese, and always give the smallest runnable version of the code first.',
  newTextAria: 'New preset text',
  charCount: '{used} / {max} char(s)',
  add: 'Add',
  cancel: 'Cancel',
  editNameAria: 'Preset name',
  editTextAria: 'Preset text',
  save: 'Save',
  unnamedPreset: 'Untitled prompt',

  noneAria: 'Inject nothing',
  noneName: 'Inject nothing',
  noneDescription:
    'New sessions are not anchored (compaction and turn re-anchoring in existing sessions are unaffected). Selecting it clears the combination below.',
  selected: 'Selected',
  emptyLibrary: 'No presets yet. Click "＋ Add preset" to create the first one.',
  joinAria: 'Add preset "{name}" to the anchor combination',
  inCombination: 'In the combination',
  overCap: 'Over the per-preset limit',
  emptyText: 'Empty (will not be injected)',
  edit: 'Edit',
  deleteConfirm: 'Delete preset "{name}"?',
  delete: 'Delete',
  previousPage: '‹ Previous',
  pageStatus: 'Page {page} / {pages} · {total} preset(s)',
  nextPage: 'Next ›',
  pageSizeLabel: 'Per page',
  pageSizeAria: 'Presets per page',
  addPreset: '＋ Add preset',

  orderTitle: 'Injection order',
  orderHint: 'Drag, or use ↑ ↓ to reorder; this order is the concatenation order',
  orderEmpty:
    'No preset selected yet: check presets above and they are concatenated into the anchor text in this order. The current state is "inject nothing", so new sessions receive no anchor.',
  orderEmptyPreview: '(empty)',
  moveUpAria: 'Move "{name}" up',
  moveDownAria: 'Move "{name}" down',
  removeAria: 'Remove "{name}" from the combination',
  totalChars: 'Total {used} / {max} char(s)',
  overLimitSuffix:
    ' —— over the limit: nothing will be injected; trim the combination or raise the combined limit',
  previewSummary: 'Combined text preview',

  'command.description': 'Anchor: inject the current combination into this session (sends no message, triggers no model reply)',
  'command.usage': 'Usage: `/anchor` anchors the current combination right away; `/anchor status` only reports state and injects nothing.',
  'command.combinationEmpty': '(currently "inject nothing")',
  'command.statusTitle': '⚓ Anchor status',
  'command.stateOn': 'on',
  'command.stateOff': 'off',
  'command.statusSwitch': 'Master switch: {state} | Combination: {combination} ({chars} char(s) / limit {max})',
  'command.statusReinject': 'Re-anchor: {source} | Turn interval: {interval} | After compaction: {afterCompaction}',
  'command.reinjectSourceLatest': 'the latest injection this plugin made',
  'command.reinjectSourceFirst': 'the original anchor',
  'command.intervalOff': 'off',
  'command.intervalTurns': '{turns} turns',
  'command.afterCompactionYes': 'yes',
  'command.afterCompactionNo': 'no',
  'command.queuedTurn': 'Queued: {count} message(s) ({chars} char(s)), waiting for the next turn boundary to land in the log',
  'command.queuedStep': '{count} more queued for the next step boundary',
  'command.noInjectionYetQueued':
    'Session log: nothing has landed yet (the queued anchor becomes the first baseline once it lands)',
  'command.noInjectionYet': 'This session: no injection yet (the first step of the next message anchors it)',
  'command.firstInjection': 'First injection in this session: seq {seq} ({chars} char(s))',
  'command.latestInjection': 'Most recent injection: seq {seq} ({chars} char(s))',
  'command.turnsSince': 'Turns since the last injection: {turns}',
  'command.compactedSince': ', with a compaction since then',
  'command.switchOff': 'The anchor master switch is off (Settings → Anchor). {usage}',
  'command.emptyCombination': 'The current combination is empty ("inject nothing"); there is nothing to inject. {usage}',
  'command.overLimit': 'The combination is {chars} char(s), above the combined limit of {max} chars; nothing was injected.',
  'command.duplicate':
    '⚓ An identical combination is already queued (waiting for the next turn boundary to land in the log); nothing was injected twice.',
  'command.anchored':
    '⚓ Anchored: {chars} char(s) · {segments} preset(s) ({combination})\nTakes effect at the next turn boundary — a running turn finishes unchanged and is never extended, and no driver is woken.\nFrom now on this session re-anchors that same text after a compaction or a turn interval.',
  'log.overLimit': 'opening prompt is {chars} chars, above the configured {max}-char limit; injection skipped',
}

/** Both dictionaries, in the exact form the client locale service registers. */
export const ANCHOR_COPY: Readonly<Record<AnchorLocale, Readonly<Record<AnchorCopyKey, string>>>> = { zh, en }

/**
 * The same table indexed by an open locale id: a locale this plugin does not
 * ship (a language-pack id, or one added to DSH later) is absent here, which is
 * what makes the English fallback below reachable.
 */
const DICTS: Readonly<Partial<Record<string, Readonly<Record<AnchorCopyKey, string>>>>> = { zh, en }

/** `{name}` placeholders inside a copy template. */
const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g

/**
 * Translate one key, interpolating its `{name}` placeholders.
 *
 * An unshipped locale id reads the English dictionary, and a key missing from
 * the resolved dictionary reads its English entry (the two shipped dictionaries
 * hold the same key set, so that branch only guards a future partial
 * dictionary). A placeholder with no matching var stays verbatim rather than
 * rendering as `undefined`.
 * @param locale - active locale id (a built-in `zh`/`en`, or an open id).
 * @param key - copy key of this plugin.
 * @param vars - values for the template's placeholders.
 * @returns the formatted text.
 */
export function translate(locale: string, key: AnchorCopyKey, vars?: CopyVars): string {
  const template = DICTS[locale]?.[key] ?? ANCHOR_COPY.en[key]
  if (vars === undefined) return template
  return template.replace(PLACEHOLDER, (match, name: string) => {
    const value = vars[name]
    return value === undefined ? match : String(value)
  })
}
