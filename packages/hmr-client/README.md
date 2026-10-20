# @dsh-hmr/hmr-client

TypeScript client for the [HMR](https://github.com/snowfoxHQ/HMR) cognitive memory HTTP service.
Part of **dsh-Hestia Memory Runtime** — the dsh plugin `dsh-hmr` bundles it, so end users normally
install the plugin rather than this package.

Zero runtime dependencies — uses the global `fetch` from Node 18+.

## Install

```bash
npm install @dsh-hmr/hmr-client
```

## Usage

```ts
import { HmrClient } from '@dsh-hmr/hmr-client';

const hmr = new HmrClient({
  baseUrl: 'http://127.0.0.1:8077', // default
  token: process.env.HMR_TOKEN,    // optional, sent as x-hmr-token
});

await hmr.waitForReady({ timeoutMs: 60_000 });

await hmr.ingest({
  content: 'Deployment keys rotate every 90 days via Fernet.',
  memory_type: 'concept',
  title: 'Key rotation policy',
});

const { memories, reasoning } = await hmr.recall({
  query: 'how often do deployment keys rotate',
  top_k: 5,
});
```

## API

| Method | Endpoint |
|--------|----------|
| `health()` | `GET /health` |
| `ingest(input)` | `POST /ingest` |
| `recall(input)` | `POST /recall` |
| `saveState(input)` | `POST /save_state` |
| `restoreState()` | `GET /restore_state` |
| `status()` | `GET /status` |
| `reindex()` | `POST /reindex` |
| `think(input)` | `POST /think` |
| `bestDecision(goal)` | `GET /best_decision` |
| `feedback(input)` | `POST /feedback` |
| `evolve(dryRun?)` | `POST /evolve` |
| `ingestImage(input)` | `POST /ingest_image` |

Helpers: `isReachable()`, `waitForReady(options)`.

## Errors

| Class | When |
|-------|------|
| `HmrConnectionError` | Service unreachable (down, wrong port) |
| `HmrError` | Non-2xx response; carries `status` and `detail` |
| `HmrIndexMismatchError` | 409 — vector index built with a different embedding provider |

## Testing

Tests boot the real FastAPI service from `vendor/hmr` on a random port with an
isolated temp storage dir. They are skipped automatically when `python` is absent.

```bash
npm test
```
