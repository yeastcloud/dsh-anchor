<div align="center">

# Anchor · 定锚

**Inject a composable instruction block into every DeepSeek Harness session — and re-anchor the same text after a compaction or a long run.**

Persona, tone, working discipline, project rules: say it once, and it keeps counting.

[![npm version](https://img.shields.io/npm/v/@yisiyun/dsh-anchor.svg?color=blue)](https://www.npmjs.com/package/@yisiyun/dsh-anchor)
[![CI](https://github.com/TianLanDaoRen/dsh-anchor/actions/workflows/ci.yml/badge.svg)](https://github.com/TianLanDaoRen/dsh-anchor/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[中文](README.md) · [Changelog](CHANGELOG.md) · [Issues](https://github.com/TianLanDaoRen/dsh-anchor/issues)

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
| 🎯 **Selectable re-anchor source** | `first` keeps repeating the session's opening text (a manual send stays a one-off); `latest` repeats the newest injection, including one you sent by hand — a persona switch inside that session. |
| 🧠 **Stateless decisions** | The trigger reads the durable session log and nothing else, in pure functions: restart, resume and replay reach the same decision, and one trigger can never fire twice. |
| 🚦 **Configurable limits** | Per-preset authoring limit and a combined injection gate, both editable in the settings page (default 8000 chars). Above the gate the plugin **refuses to inject and logs it** instead of silently truncating your text. |
| 📤 **Send by hand** | The composer button sends the current combination as an ordinary message and records its digest, which is how `latest` mode recognises it. |
| 🎛 **Self-drawn settings page** | Paged preset library, ordered injection list with drag/↑↓ reordering, and the re-anchor policy — all visual, no config file editing. |
| 🔒 **Local only** | No network, no telemetry. Its whole state lives in your own `~/.dsh/settings.yaml`. |

## Install

```sh
# Requires DeepSeek Harness (Web profile)
dsh plugin --profile web add @yisiyun/dsh-anchor

# The host half loads at boot: restart the profile
dsh web
```

Then open **Settings → 定锚 (Anchor)**, add a few presets, check them, drag them into the order you want, and start a new session.

**Requirements**: Node `^22.19 || >=24`; DeepSeek Harness 0.1.5 line (verified from `0.1.5-rc.2`). The plugin ships a host half (injection logic) and a client half (settings page and composer button). The UI is currently Chinese.

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
| `manualSendDigests` | `[]` | Digests of hand-sent combinations (maintained by the client, up to 5) |

## FAQ

**Why not inject every turn?** Repeating the block every turn burns context and desensitises the model to it. The anchor fires exactly when information is lost: after compaction, and after your configured turn interval.

**Does re-anchoring fight the compaction summary?** No. The summary records *what happened*; the anchor restates *how you want things done*.

**What happens if I press the send button in `latest` mode?** The message arrives as a normal user message and is recorded; from then on that session re-anchors **that** text — a persona switch for the session. Switching back to `first` returns to the opening text.

**Limits of manual-send recognition?** The host only sees the log, so it matches by content digest: pasting a byte-identical copy of a hand-sent combination also counts (the outcome is the same text, so it does not matter). Unrecorded user messages are never counted.

**Does it send anything anywhere?** No. It never touches the network; the only file it writes is its own namespace in `~/.dsh/settings.yaml`.

## Development

```sh
pnpm install     # dependencies (prepare builds once)
pnpm check       # typecheck + 63 tests + build
pnpm build       # lib/index.js (host) and lib/client.js (client)
```

Client-half changes take effect on a page refresh; **host-half changes need a profile restart**.

## Releasing

```sh
gh workflow run release.yml -f bump=minor
```

Publishing uses **npm trusted publishing (OIDC)** — no npm token is stored in the repository, and releases carry a provenance attestation. The very first publish is manual (npm requires the package to exist before a trusted publisher can be configured); afterwards every release goes through the workflow.

## License

[MIT](LICENSE) © 2026 YiSiYun Studio (一笥云)
