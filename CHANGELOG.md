# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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
