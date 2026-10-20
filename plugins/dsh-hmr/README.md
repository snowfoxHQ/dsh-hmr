# dsh-hmr — dsh-Hestia Memory Runtime

**Full name: dsh-Hestia Memory Runtime.** Package name `dsh-hmr`, tools prefixed `hmr_`.

Cognitive memory for [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh), powered by
[HMR](https://github.com/snowfoxHQ/HMR). It stores decisions, reasoning chains and reflections, then
recalls them by meaning in later sessions.

> **Not** hot module replacement. `dsh-Hestia Memory Runtime` shares an acronym with the official
> `@deepseek-ai/dsh-hmr` (hot module replacement) but is an unrelated agent-memory plugin.

Five tools are registered on the harness tool registry:

| Tool | Purpose |
| --- | --- |
| `hmr_recall` | Semantic search over long-term memory, with the reasoning trace for why each memory matched. |
| `hmr_ingest` | Persist a durable memory: `concept`, `project`, `decision`, `runtime`, `task`, `workflow`, `agent_memory`, `execution`, `reflection`. |
| `hmr_think` | Record a reasoning chain; supplying the outcome triggers reflection. |
| `hmr_reflect` | Compare intent vs. actual outcome and extract insights worth keeping. |
| `hmr_evolve` | Deduplicate, abstract and prune memory. Supports `dry_run`. |

## Prerequisites

- **DeepSeek Harness** — the host program that provides the `dsh` command. This plugin is loaded
  by dsh and does nothing on its own:

  ```bash
  npm i -g @deepseek-ai/dsh
  ```

  Package: <https://www.npmjs.com/package/@deepseek-ai/dsh> ·
  Repository: <https://github.com/deepseek-ai/deepseek-harness>

  Needs dsh `0.2.1` or newer; the plugin's peer dependencies are `@deepseek-ai/dsh-tools@^0.2.1-rc.2`.
  dsh is currently published as a release candidate, so the command above installs `0.2.1-rc.2` —
  pin an exact version if you need a frozen one.
- **Node 18+**
- **Python 3.10+**

> The official `@deepseek-ai/dsh-hmr` package is **not** required. That one is hot module
> replacement; this plugin only needs dsh itself.

## Install

```bash
# 1. Python runtime (3.10+)
pip install pydantic numpy fastapi uvicorn
pip install sentence-transformers     # optional: better embeddings

# 2. Check the environment
npx dsh-hmr doctor

# 3. Mount the plugin into a profile
dsh plugin --profile web add dsh-hmr
```

## Configuration

Everything is optional; the defaults work on a clean machine.

| Option | Default | Meaning |
| --- | --- | --- |
| `process` | `'managed'` | `managed` spawns and supervises the Python service; `external` connects to one you run yourself. |
| `baseUrl` | `http://127.0.0.1:8077` | Service base URL. Host/port are reused when spawning. |
| `token` | – | Shared secret, sent as `x-hmr-token` / `HMR_TOKEN`. |
| `python` | `'python'` | Interpreter used to spawn the service. |
| `serviceDir` | bundled copy | Directory containing `server.py`. |
| `storagePath` | `~/.dsh-hmr/data` | Where HMR keeps its data. Invalid paths fall back to the default with a warning. |
| `startupTimeoutMs` | `180000` | How long to wait for `/health` on first startup. |
| `requestTimeoutMs` | `120000` | Per-request timeout. |
| `offline` | `false` | Sets `HF_HUB_OFFLINE=1` / `TRANSFORMERS_OFFLINE=1` for the service. Turn this on when the embedding model is already cached — it cuts startup from ~75s to a few seconds. |

Example `cordis.patch.yml` override:

```yaml
- id: hmr-memory
  config:
    process: external
    baseUrl: http://127.0.0.1:8077
    token: !env HMR_TOKEN
    offline: true
```

### Embeddings

The embedding backend is **not** configured here. HMR reads it from its own environment
(`HMR_EMBEDDING_*`, `.env` next to the service). The plugin only forwards `HMR_HOST`, `HMR_PORT`,
`HMR_STORAGE_PATH`, `HMR_TOKEN` and the offline switches.

## CLI

```bash
dsh-hmr doctor          # python version, deps, bundled runtime, port availability
dsh-hmr env             # the environment the plugin would spawn with
dsh-hmr serve [args...] # run the service in the foreground (same as `process: external`)
```

`serve` is handy for a supervised setup:

```bash
dsh-hmr serve &
# then set `process: external` in the profile config
```

## External mode

Point the plugin at a service you own:

```bash
HMR_STORAGE_PATH=/var/lib/hmr HMR_TOKEN=secret dsh-hmr serve
```

```yaml
process: external
baseUrl: http://127.0.0.1:8077
token: secret
```

In external mode the plugin never starts or stops the process; it only probes `/health` for 15s at
first tool call and reports a clear error if nothing answers.

## Lifecycle

In managed mode the plugin:

1. Warms the service in the background right after mount, so the first tool call does not pay the
   model-load cost.
2. Waits for `/health` before every tool call (`startupTimeoutMs` is the cold-start ceiling).
3. Sends `SIGTERM` on unload, escalating to `SIGKILL` after 5s.

Startup failures never block harness boot; they surface on the first tool call with the child's stderr
tail attached.

## Troubleshooting

**`doctor` says the port is in use.** Another HMR instance is running. Either set
`process: external` to share it, or change `baseUrl` to a free port.

**First tool call times out.** Cold start loads the embedding model. Raise `startupTimeoutMs`, or set
`offline: true` once the model is cached.

**`embeddings: falls back to TF-IDF`.** `sentence-transformers` is missing. HMR still works with
reduced recall quality.

**Storage path warnings.** If `HMR_STORAGE_PATH` points at a drive that no longer exists (e.g. a
removable disk), the plugin ignores it and uses `~/.dsh-hmr/data`.

## License

MIT. HMR itself is MIT as well; its source is vendored under `python/`.
