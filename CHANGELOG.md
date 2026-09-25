# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.12.0] — 2026-09-25

跨线适配 ⇒ minor：本版把插件移到 DeepSeek Harness **0.1.7-rc.2** 线（依赖与 peer 范围全部改为 `^0.1.7-rc.2`，并显式声明 `@deepseek-ai/schemastery ^3.18.4` —— 新的 `Config` 用到该版本才有的 `Schema.prototype.volatile()`）。旧线（0.1.2–0.1.6）不再受支持：`^0.1.7-rc.2` 的 peer 范围会挡住它，装上去也不会再注册设置节。

### Changed

- **设置改成「插件自己的 `Config` 即设置文档」**：0.1.7 把 `ctx.settings` 整个换成 `SettingsForms`，`installSection` 与 `register` 双双消失（调用即 `TypeError`，而 loader 把失败的 entry 当致命 ⇒ 整个 profile 起不来）。Host 半现在把设置 schema 作为 `Config` 导出，`ctx.settings.configure({ auto: false }, ctx.fiber)` 只登记**页面策略**（包在 `ctx.inject(['settings'], …)` 子上下文的 effect 里）；取值走 `config.<field>.get()`，读取是防御式的（访问器与普通值都接受，缺失字段回落到默认值），并且**不复核**已经过 loader 校验的值。`auto: false` 的理由是官方 README 写明的：`autoGenerate` 是给「从 schema 生成页面」的客户端用的，而**目前没有任何随发行版交付的客户端这么做**；本插件自带设置页，正是该注册 `auto: false` 的场景。
- **每个设置字段都标记 `.volatile()`**：0.1.7 的引擎只把 volatile 字段投影成表单，没有 volatile 字段的 entry 会从 `describe()` 里直接消失，任何写入也被拒（`Plugin entry "…" has no volatile fields`）。那等于既没有设置页，退休的 `~/.dsh/settings.yaml` 段也导不进来。
- **注入消息的 `source.kind` 改为本插件自己的 producer kind（`plugin:dsh-anchor`）**：0.1.7 的 `MessageSourceMap` 不再有 catch-all 的 `'plugin'`（按官方 d.ts：each producer declares its own `kind` … there is no shared catch-all `plugin` kind），session format V4 更是直接拒收 `kind: 'plugin'`。同时 V3→V4 迁移对不在它两张表里的 producer 走 `` `plugin:${plugin}` `` 兜底，即老会话里的 `{kind:'plugin',plugin:'dsh-anchor'}` 会被改写成 `plugin:dsh-anchor`——写入侧用同一个字符串，升级前后的注入在日志里就是同一个来源；读取侧两种形状都认，**老会话的重锚基线不会丢**。
- **`cordis.patch.yml` 的 entry id 由 `anchor` 改为 `dsh-anchor`**：0.1.7 上「设置命名空间 = 配置树 entry id」，引擎按**同名 id** 把退休的 `settings.yaml` 导入 entry（section `dsh-anchor` → entry `dsh-anchor`）。id 与插件命名空间保持一致，公司开工锚预设才能随线迁移进来，设置文档也不会被悄悄改名。`tests/patch-manifest.spec.ts` 现在会在这个不变量被破坏时失败。
- **Client 半改走 `ctx.configForms`**：0.1.7 删除了 `settingsScope` 服务（在 0.1.7-rc.2 的整棵安装树里 0 处引用），设置表单由其提供者按「entry id → 表单」共享。界面只认这个传输端口（`AnchorSettingsHost`：snapshot / subscribe / set / unset），因此设置页、控制器与组件都不需要知道表单从哪来；服务用 `ctx.get` 读取，不是必备依赖，没有它的 shell 只是不显示这一页。
- Host 半不再把 `settings` 声明为必备服务（`inject: []`）：0.1.7 上它只是可选能力，声明成必备会让没有 settings 服务的 profile 直接起不来。

### Added

- `tests/settings-wiring.spec.ts`：覆盖此前**没有任何测试跑到**的 0.1.7 分支——`ctx.inject(['settings'], …)` 子上下文里以 effect 注册 `configure({ auto: false }, ctx.fiber)`、`ctx.get('settings')` 的读取路径、以及「同一个 `Config` 字段无论来自访问器还是普通值都得到同一份设置」这一 Host 半赖以成立的前提。
- `tests/trigger.spec.ts` 新增 producer kind 用例：迁移后的来源被认作自己、迁移前后混在一条历史里仍取到首/末注入、以及其他 producer（如 `plugin:compact`）被拒。
- `tests/patch-manifest.spec.ts` 新增两条不变量：`INJECTION_SOURCE_KIND === \`plugin:${NS}\``、peer 范围只收 0.1.7 线。

### Fixed

- **测试套件此前是「假绿」**：两个行为套件的桩给的是 `settings.installSection`，因此 0.1.7 的接线（`configure` + 访问器取值）一次都没被执行过。现在桩改成真实路径——`apply(ctx, config)` 收到的是逐字段访问器，`setSettings` 就是改这份运行中的配置。

## [0.11.0] — 2026-09-15

### Added

- **按上下文 token 压力重锚（`reinjectTokenThreshold`，默认 0 关闭）**：作为轮数之外的第二把尺。判定读官方 `dsh-token-meter` 通过 `ctx.sessionProjections` 发布的 `contextPressure` 投影——这个数就是 Web GUI 输入框旁边显示的上下文占用（`projectedTokens` 优先，回落 `pressureTokens`），所以阈值用绝对 token 数。触发是**边沿式**的：每个会话记一个「已触发位」，读数低于阈值就重新武装，升到阈值以上触发一次即解除武装，因此占用一直很高也不会一轮一轮地重锚；压缩把占用打回阈值以下会重新武装，下一次上升再触发一次。注入时机与门禁与其他触发完全一致——只在**下一轮的第一个 step**（不中途插队、不延长正在跑的回合、不给「无输入」的 step 1 挂靠），文本仍由 `reinjectSource` 决定，合并上限照旧生效，被门禁拦下的那一次跨越保持待触发；`/anchor status` 一并报告阈值。
- 设置页新增「按 token 压力重锚」数字行，中英双语文案；未挂载 token meter 的 profile 行为与从前完全一致——投影接缝读不到就永远不触发，不报错也不告警（新增的两个依赖都是 type-only，`lib/index.js` 不引入任何新的运行时依赖）。

### Fixed

- **「恢复默认」现在也会清掉 `anchorSubagents` 与 `reinjectTokenThreshold`**：重置此前只清了一部分字段，存储里残留的值会让 Host 半继续按非默认值处理（例如子代理仍被跳过），而设置页显示的却是默认值。

### Changed

- **文档纠正**：此前两份 README 与源码注释一律声称「触发判定只读会话日志」。压缩与轮数两个触发确实如此；token 压力触发不是——它读官方 token 计量（该计量本身是对会话日志的回放），并且按会话记一个进程内的「已触发位」，README 已写明「重启后该位回到已武装，仍高于阈值时最多再重锚一次」。
- 两份 README 同步新增字段说明、触发时机表行、token 压力的 FAQ；路线图最后一项移入已完成表（`v0.11.0`），并注明计划项已全部实装。

## [0.10.0] — 2026-09-15

### Added

- **预设导入 / 导出**：设置页可把整库预设（含当前组合）导出成一份自带格式标记与版本号的 JSON 文档，也可从文件导入。导入先完整校验再落地——空文件、非 JSON、非本插件的文档、版本不符、预设列表缺失、id/名称/正文非法、id 重复、条数超限、组合指向不存在的预设，**每一种都以一条明确理由整体拒绝**，不会半途替换掉你的库；确认框会说明将替换几条、组合是否随之改变。

## [0.9.0] — 2026-09-15

### Added

- **第三种重锚来源「按最新组合刷新」（`reinjectSource: 'refresh'`）**：前两档都从会话日志里取文本（`first` 定锚原文 / `latest` 最近一条本插件注入），`refresh` 则用设置页里**当前**的组合——改了预设或勾选，正在进行的会话下次重锚就换成新文本。两处门禁（合并上限、step 1 无输入不注入）同样适用。
- 设置页「重锚取哪一条」由两档变三档；中英双语文案、`/anchor status` 的来源名与两份 README 同步。
- 路线图改为表格：**已完成的项保留并打 ✅ + 删除线**，另列实装版本与日期。

## [0.8.1] — 2026-09-15

### Fixed

- **`/anchor` 不再把锚塞进 agent 的 inbox**：inbox 条目是「待发送输入」——客户端会把它显示成输入框里的待发送消息，loop 还可能为它自己开一个回合，于是出现「AI 对着一条插件消息回复、而用户没发过任何东西」。现在锚由插件自己持有（按会话 id），由 pre-step 在**下一条消息的第一个 step** 注入：不进输入框、不开回合、也不延长正在跑的回合。
- 设置页与 README 的对应表述同步；新增回归测试断言 `/anchor` 对 inbox 零写入。

## [0.8.0] — 2026-09-15

### Added

- 设置页新增「子代理会话也定锚」开关（`anchorSubagents`）。

### Changed

- **子代理（委派出去的子会话）默认不再定锚**：`dsh-subagent` 会把委派策略以 `source: 'delegation'` 写进子会话自己的日志（官方注明这是为了「仅凭日志即可重建出身」），插件据此识别委派会话并默认跳过。此前它们确实会被注入——实测在一条子会话日志里找到过一条 2063 字的插件来源消息。人设与纪律是给「你自己在开的会话」的，子代理复述一遍只是白花 token。

## [0.7.0] — 2026-09-15

### Added

- **中英双语（zh / en）**：设置页文案改走 DSH 的语言服务——注册 `settings.anchor` 命名空间，左侧导航与整页文案跟随语言设置切换，不再是写死的中文；`/anchor` 与 `/anchor status` 的全部输出、以及超限时那条 `logger.warn`，改为跟随宿主进程的 `LC_ALL` / `LANG`（语言标签首段为 `en`，如 `en`、`en_US.UTF-8` → 英文，其余 → 中文；与浏览器偏好无关，因为 Host 半没有语言服务）。两端共用新增的 `src/copy.ts`：一份 `{ zh, en }` 文案表 + `{name}` 占位插值 + 英文回落，新增依赖 `@deepseek-ai/dsh-client-locale`（dev + peer）。

### Changed

- **文档纠正**：README.en.md 删掉「The UI is currently Chinese.」这条已经不成立的说明；两份 README 补上「设置页跟随 DSH 语言设置、命令与日志跟随 `LC_ALL`/`LANG`」，并移除路线图里已完成的「设置页 i18n（当前界面为中文）」。

## [0.6.2] — 2026-09-15

### Fixed

- 设置页那段提示文案过时：它写着「重锚始终使用本次会话开始时那段原文」，但那只在「定锚原文」档成立——选「最近一条」时，用 `/anchor` 定锚新组合会立刻改变重锚内容。改为按「重锚取哪一条」分档说明。

## [0.6.1] — 2026-09-15

### Changed

- 文档不再提及其他插件：FAQ 里那条对比改为本插件自身的范围说明（只负责指令，不接管记忆与检索）。

## [0.6.0] — 2026-09-15

### Removed

- **「发组合」按钮与整套"内容摘要认领"机制**：`/anchor` 命令是它的完全上位替代（同样把组合送进会话，却不花 token、不开回合、不延长正在跑的回合），而按钮为了被认出来，还得让 Host 拿用户消息的内容摘要去比对——又丑又脆的折中。随之删除 `src/digest.ts`、`src/client/SendPromptDock.tsx`、客户端 `conversation.composer.dock` 注册，以及设置项 `manualSendDigests`。

### Changed

- **`/anchor` 改为排在下一个回合边界**（原为下一个 step）：正在跑的回合会在自己的 step 边界把排队消息吞下去，于是凭空多跑一步模型——中途定锚看起来就像"卡住"。现在一律等回合边界，绝不延长进行中的工作。
- `/anchor status` 改为同时读 agent 的 inbox：**已排队但尚未落地**的锚会被报告出来，不再出现"刚说已定锚、status 却说尚无注入"的自相矛盾；对同一条组合重复定锚也不再排第二份。
- 设置页「重锚取哪一条」的说明与两份 README 同步改写；"什么算本插件的注入"不再依赖内容比对。

## [0.5.1] — 2026-09-15

### Added

- **`/anchor` 命令**：把当前组合立即定锚进本会话。命令处理器在接收它的 agent 上本地执行（官方契约原话 "Execute against the receiving agent without sending the command to the model"），因此**不花 token、不开新回合、不打断当前回合**；注入的是插件来源消息，所以「最近一条本插件注入」模式天然认得它，不依赖任何内容比对。
- **`/anchor status`**：只读报告总开关、组合与字数、重锚来源与轮数间隔、本会话注入历史（首条 / 最近一条的 seq、来源、字数）与距上次注入的轮数；不注入任何内容。
- 依赖 `@deepseek-ai/dsh-commands`（dev + peer），命令以 `ctx.inject(['commands'], …)` **可选注册**：没有命令服务的 profile 里插件照常工作。

## [0.5.0] — 2026-09-15

此版本为发布流程误发，**内容与 0.4.2 完全一致、不含任何功能改动**：发版前未同步上一个发版提交，工作流在旧 HEAD 上跑完并发出。`/anchor` 命令由 0.5.1 承载；发版工作流已加闸——有版本递增时必须在 CHANGELOG 里找到对应段落，否则直接失败。

## [0.4.2] — 2026-09-15

### Fixed

- **`cordis.patch.yml` 的包名未加引号，导致 profile 启动失败**：`@` 是 YAML 保留字符，`name: @yeastcloud/dsh-anchor` 这种裸标量非法，Harness 解析 overlay 时会直接抛 `bad indentation of a mapping entry`，整个 profile 起不来（0.4.1 装了也启动不了）。改为 `name: '@yeastcloud/dsh-anchor'`。

### Added

- `tests/patch-manifest.spec.ts`：解析 bundle patch、断言它注入的插件名等于本包 `package.json` 的 `name`，并检查 `files` 白名单含 `lib` / `cordis.patch.yml` / `LICENSE`。这类"只有启动时才暴露"的错误从此在 CI 就被拦住（已验证：坏形式会红，修好后全绿）。

### Changed

- 发版工作流的 GitHub Release 笔记改为取本文件对应的版本段落（原先用 `--generate-notes`，而本项目直推 main、没有 PR 可汇总，结果只剩一个 compare 链接）；缺段落时退回自动生成并发 `::warning::`。
- 发版工作流修复：改用**注记 tag** 并显式推送（`--follow-tags` 不推轻量 tag）、新增 `mode=stage|direct` 与 `bump=none`、GitHub Release 创建改为幂等。

## [0.4.1] — 2026-09-15

### Changed

- **许可证由 MIT 改为 CC BY-NC-SA 4.0**：允许非商业使用与修改、要求署名、衍生物须以同一协议分发；商用需另行授权。

## [0.4.0] — 2026-09-15

### Added

- **重锚来源可选**：设置页新增「定锚原文 / 最近一条」分段按钮（`reinjectSource`）。选「最近一条」时，「📤 发组合」手发出去的那条会取代定锚原文成为该会话的基线——等于在会话内切换人设；选「定锚原文」则手发只算一次性。
- **手发识别**：客户端在发送前记录组合的内容摘要（`manualSendDigests`，cyrb53，最多 5 条），Host 据此把那条普通用户消息认作本插件注入。
- 单元测试扩到 6 个 spec / 63 项（新增控制器写入纪律与摘要用例）。

### Changed

- 项目更名为 **定锚（Anchor）**，包名 `@yeastcloud/dsh-anchor`，设置命名空间 `dsh-anchor`，设置页导航项 `定锚`。
- 词表统一：开场白 → **定锚**；补注 → **重锚**；「📤 发预设」→ 「📤 发组合」。

## [0.3.0] — 2026-09-15

### Added

- **预设自由组合**：单选取值改为有序多选（`selectedIds`），多条预设按顺序拼接注入。
- **三区设置页**：分页预设库（顶部固定互斥的「不注入」行、复选框多选）、分页器 + 新增、注入顺序（拖拽或 ↑/↓ 排序、合并字数与预览）。
- **可配上限**：`maxPromptChars`（编辑限长）与 `maxCombinedChars`（注入门禁，超限不注入并写 warn），默认双双 8000。
- 单元测试扩到 41 项。

### Changed

- 组合文本、长度上限与重锚策略全部进设置页；写入改为**按字段写**（勾选/拖拽只写 `selectedIds`）。

### Fixed

- 不再把「开场白」注入到已经跑过回合的续聊会话里（首轮注入要求 `turn === 1`）。

## [0.2.0] — 2026-09-15

### Added

- **压缩后自动重锚**：日志出现 `compaction/summary` 后，在下一个 step 边界把定锚原文补注入（含回合中途）。
- **按轮数重锚**：距上次注入满 `reinjectTurnInterval` 轮（默认 20，0 关闭）后在下一轮开始时补注入。
- 重锚文本来自会话日志的**首次注入原文**，不跟随设置页的实时选择。
- 单元测试 24 项。

## [0.1.0] — 2026-08

### Added

- 会话首轮注入一条用户自定义 Prompt；设置页管理多预设单选。
- 设置持久化到 `~/.dsh/settings.yaml` 的插件命名空间。
- `conversation.composer.dock` 的「发预设」按钮。
