<div align="center">

# Anchor · 定锚

**Inject a composable instruction block into every DeepSeek Harness session — and re-anchor the same text after a compaction or a long run.**

Persona, tone, working discipline, project rules: say it once, and it keeps counting.

[![npm version](https://img.shields.io/npm/v/@yeastcloud/dsh-anchor.svg?color=blue)](https://www.npmjs.com/package/@yeastcloud/dsh-anchor)
[![CI](https://github.com/yeastcloud/dsh-anchor/actions/workflows/ci.yml/badge.svg)](https://github.com/yeastcloud/dsh-anchor/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-CC%20BY--NC--SA%204.0-lightgrey.svg)](LICENSE)

[中文](README.md) · [Changelog](CHANGELOG.md) · [Issues](https://github.com/yeastcloud/dsh-anchor/issues)

</div>

---

## The problem

You open a session with an instruction block: answer in Chinese, lead with the conclusion, ask before destructive commands, keep code minimal. It works for a few turns. Then:

- **turn 40** — the block sits at the very bottom of the context and the model starts to forget it;
- **after `/compact`** — a summary swallows it. Summaries describe what happened; they never repeat *how you want things done*;
- **inside a long tool loop** — dozens of tool results push it further away, and both style and discipline drift.

`dsh-anchor` drops an anchor on that instruction block: inject it once at session start, then re-inject **the same text** whenever the session is compacted or crosses the turn interval you configured.

## Features

| Feature | What it does |
| --- | --- |
| 🧩 **Composable presets** | Build up to 100 presets, check any subset, and inject them joined in the order you drag them into. |
| ⚓ **Re-anchor after compaction** | Watches for `compaction/summary` (automatic pressure compaction or `/compact`) and re-anchors at the next step boundary — including mid-turn, so the very next request carries it. |
| 🔁 **Re-anchor by turn count** | Re-anchors at the start of a turn once N turns (default 20, configurable, 0 disables) have passed since the last injection. |
| 🎯 **Selectable re-anchor source** | `first` keeps repeating the session's opening text; `latest` repeats the newest injection of this plugin — for example one you anchored later with `/anchor`, which switches the persona inside that session. |
| 🧠 **Stateless decisions** | The trigger reads the durable session log and nothing else, in pure functions: restart, resume and replay reach the same decision, and one trigger can never fire twice. |
| 🚦 **Configurable limits** | Per-preset authoring limit and a combined injection gate, both editable in the settings page (default 8000 chars). Above the gate the plugin **refuses to inject and logs it** instead of silently truncating your text. |
| ⚓ **`/anchor` command** | Type `/anchor` to anchor the current combination into this session right away: the handler runs locally against the agent, so it **costs no tokens, opens no turn, and never extends a turn already running** (the anchor waits for the next turn boundary). `/anchor status` reports without injecting. |
| 🎛 **Self-drawn settings page** | Paged preset library, ordered injection list with drag/↑↓ reordering, and the re-anchor policy — all visual, no config file editing. |
| 🔒 **Local only** | No network, no telemetry. Its whole state lives in your own `~/.dsh/settings.yaml`. |

## Install

```sh
# Requires DeepSeek Harness (Web profile)
dsh plugin --profile web add @yeastcloud/dsh-anchor

# The host half loads at boot: restart the profile
dsh web
```

Then open **Settings → 定锚 (Anchor)**, add a few presets, check them, drag them into the order you want, and start a new session.

**Requirements**: Node `^22.19 || >=24`; DeepSeek Harness 0.1.5 line (verified from `0.1.5-rc.2`). The plugin ships a host half (injection logic) and a client half (settings page).

**Language**: the settings page and its left-nav entry follow the DSH language setting (中文 / English); `/anchor` output follows the host process's `LC_ALL` / `LANG` (a tag whose first segment is `en` — `en`, `en_US.UTF-8` — reads English, anything else Chinese).

## Commands

Type `/anchor` in any session:

| Command | What it does |
| --- | --- |
| `/anchor` | Anchors the current combination into **this session**: one plugin-sourced message is injected and takes effect at the **next turn boundary** (no driver wake-up, and a turn already running is never extended), and every later compaction / turn-interval re-anchor reuses it. The handler runs locally on the receiving agent, so it **costs no tokens and produces no model reply**. |
| `/anchor status` | Read-only report: master switch, combination and length, re-anchor source and turn interval, this session's injection history (first / latest seq and length, plus anything still queued), and how many turns passed since the last injection. **Injects nothing.** |

Every refusal path reports an error instead of injecting something approximate: switch off, empty combination, or a combined length above the configured limit.

> Why a command: the command contract states the handler runs locally against the agent and the command is **not sent to the model** — which is exactly what "drop an anchor on this conversation" should be. That is also why the earlier composer button, and with it the whole "recognise it by content digest" mechanism, is gone: the command delivers the same text without spending tokens, opening a turn, or needing to recognise itself.

## How it works

- **Session start** — on the first step of the session's *own* first turn (`turn === 1`), the plugin prepends one `source.kind = "plugin"` user message carrying the combined text. It is model-visible and logged, and it is distinguishable from a real submission.
- **Re-anchor** — if the log shows a completed summarizing compaction after the last injection, the next step boundary re-injects (mid-turn included). If N turns have passed, step 1 of the next turn re-injects.
- **Stateless** — every injection moves the reference seq forward, so a trigger fires once. Sessions that were never anchored are never given a belated "opening line" mid-conversation.
- **Manual send** — the composer delivers it as an ordinary user message, so the client records a content digest (cyrb53) and the host claims matching user messages as this plugin's own.

## Configuration

Edit in **Settings → 定锚**, or in the `dsh-anchor` section of `~/.dsh/settings.yaml`:

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch: off stops both anchoring and re-anchoring |
| `selectedIds` | `['default']` | Ordered combination; an empty array means "inject nothing" |
| `prompts` | 1 item | Preset library, up to 100 items, name ≤ 200 chars |
| `reinjectAfterCompaction` | `true` | Re-anchor after a summarizing compaction |
| `reinjectTurnInterval` | `20` | Turn interval between re-anchors (0–10000, 0 disables) |
| `maxPromptChars` | `8000` | Authoring limit per preset; never truncates stored text |
| `maxCombinedChars` | `8000` | Injection gate for the combined text; above it nothing is injected and a warning is logged |
| `reinjectSource` | `'first'` | Which injection a re-anchor repeats: `first` or `latest` |

## FAQ

**Why not inject every turn?** Repeating the block every turn burns context and desensitises the model to it. The anchor fires exactly when information is lost: after compaction, and after your configured turn interval.

**Does re-anchoring fight the compaction summary?** No. The summary records *what happened*; the anchor restates *how you want things done*.

**What happens if I anchor with `/anchor` in `latest` mode?** That anchor becomes the session's newest injection, so later compaction and turn-interval re-anchors repeat **it** — a persona switch for the session. Switching back to `first` returns to the opening text.

**What counts as an injection?** Only messages this plugin sourced itself: the opening anchor, a compaction or turn-interval re-anchor, and an anchor you placed with `/anchor`. Text you type or paste never counts, and no content comparison is involved.

**Does it send anything anywhere?** No. It never touches the network; the only file it writes is its own namespace in `~/.dsh/settings.yaml`.

## Development

```sh
pnpm install     # dependencies (prepare builds once)
pnpm check       # typecheck + 79 tests + build
pnpm build       # lib/index.js (host) and lib/client.js (client)
```

Client-half changes take effect on a page refresh; **host-half changes need a profile restart**.

## Releasing

```sh
gh workflow run release.yml -f bump=minor                  # bump and release
gh workflow run release.yml -f bump=none                   # release the version already in the repository
gh workflow run release.yml -f bump=patch -f dry_run=true   # verify the pipeline only, nothing is committed or published
```

The workflow bumps the version, runs `pnpm check`, commits and pushes an **annotated tag**, publishes to npm, and creates a GitHub Release. Publishing uses **npm trusted publishing (OIDC)** — no npm token is stored in the repository, and every release carries a provenance attestation.

`mode` must match the permission granted to this package's Trusted Publisher on npmjs:

| `mode` | npm permission required | Behavior |
| --- | --- | --- |
| `stage` (default) | `npm stage publish` | the version is staged on npm and becomes public once a maintainer approves it with 2FA: `npm stage list <pkg>` → `npm stage approve <stage-id>` |
| `direct` | `npm publish` | live as soon as the workflow finishes |

The very first publish is manual (npm requires the package to exist before a trusted publisher can be configured); afterwards every release goes through the workflow.

## License

[CC BY-NC-SA 4.0](LICENSE) © 2026 YiSiYun Studio (一笥云)

**Granted**: non-commercial use, modification, and redistribution under the same license. **Required**: attribution (keep the copyright and license notice, and state changes). **Prohibited**: any commercial use — contact YiSiYun Studio for a commercial license.

> Note: this is a **source-available**, non-commercial license, not an OSI-approved open-source license. The plugin comes with no warranty.
