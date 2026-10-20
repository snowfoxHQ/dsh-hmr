# dsh plugin listing — dsh-Hestia Memory Runtime

Copy-paste source of truth for the dsh plugin directory / dsh.so submission. Keep the display
name identical everywhere so the acronym clash with `@deepseek-ai/dsh-hmr` (hot module
replacement) never reads as the same thing.

| Field | Value |
| --- | --- |
| Display name | **dsh-Hestia Memory Runtime** |
| Package | `dsh-hmr` |
| npm | `https://www.npmjs.com/package/dsh-hmr` |
| Repository | _(to fill in once the public remote exists)_ |
| Tags | `memory`, `cognition`, `agent-memory`, `rag`, `deepseek-harness` |
| Tools | `hmr_recall`, `hmr_ingest`, `hmr_think`, `hmr_reflect`, `hmr_evolve` |
| Install | `dsh plugin --profile <name> add dsh-hmr` |

## One-liner

> **dsh-Hestia Memory Runtime** — 给 DeepSeek Harness 的 agent 装上跨会话的认知记忆：推理链、反思循环与自我演化，而非热更新。

> **dsh-Hestia Memory Runtime** — cross-session cognitive memory for DeepSeek Harness agents: reasoning chains, reflection loops and self-evolution. Not hot module replacement.

## Short description

**dsh-Hestia Memory Runtime**（包名 `dsh-hmr`）把 HMR 认知运行时挂进 dsh，注册五个工具：
`hmr_recall` 按语义检索长期记忆并返回匹配理由，`hmr_ingest` 写入决策/概念/执行轨迹，
`hmr_think` 记录推理链，`hmr_reflect` 对比预期与实际结果提炼洞察，`hmr_evolve` 去重抽象与剪枝。
插件默认以 managed 模式托管 Python 服务（首次调用时拉起，卸载时回收），也可对接常驻服务。

**dsh-Hestia Memory Runtime** (`dsh-hmr`) mounts the HMR cognitive runtime into dsh and registers
five tools: `hmr_recall` for semantic search with match rationale, `hmr_ingest` for decisions,
concepts and execution traces, `hmr_think` for reasoning chains, `hmr_reflect` for intent-vs-outcome
learning, and `hmr_evolve` for deduplication/abstraction/pruning. The Python service is managed by
the plugin by default — spawned on first use, reaped on unload.

## Naming note

`dsh-Hestia Memory Runtime` and the official `@deepseek-ai/dsh-hmr` (hot module replacement) are
unrelated. This plugin exposes no module-reload functionality; the `hmr_` prefix comes from the
upstream [HMR](https://github.com/snowfoxHQ/HMR) runtime it wraps.
