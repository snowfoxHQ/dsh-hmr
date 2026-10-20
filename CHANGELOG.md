# Changelog

All notable changes to this workspace are documented here. Both published packages
(`@dsh-hmr/hmr-client` and `dsh-hmr`) share the same version line.

## 0.1.0 — 2026-10-20

First working release: HMR cognitive memory mounted as a dsh plugin.
Display name: **dsh-Hestia Memory Runtime** (package `dsh-hmr`; unrelated to the official
`@deepseek-ai/dsh-hmr` hot-module-replacement plugin).

### Added

- `packages/hmr-client` — typed HTTP client for the 13 HMR service endpoints
  (`/health`, `/ingest`, `/recall`, `/save_state`, `/restore_state`, `/reindex`, `/status`,
  `/think`, `/best_decision`, `/feedback`, `/evolve`, `/ingest_image`), with token auth,
  request timeouts and `waitForReady`.
- `plugins/dsh-hmr` — the dsh plugin: five `hmr_*` tools (`recall`, `ingest`, `think`,
  `reflect`, `evolve`), schemastery config, managed/external process modes, and a
  `dsh-hmr` CLI (`doctor`, `serve`, `env`).
- Managed mode spawns the bundled Python service on first use, warms it in the background,
  and reaps it with `SIGTERM` → `SIGKILL` on unload.
- `scripts/vendor-python.mjs` copies `vendor/hmr` into the plugin package so the published
  tarball is self-contained; `scripts/build.mjs` bundles the plugin with esbuild and inlines
  the client, leaving `@deepseek-ai/*` as peer-provided externals.
- Integration tests for both packages against a real service process.

### Fixed

- `dsh-hmr` advertised `memory_type` values (`lesson`, `fact`, `preference`, `episode`) that
  `MemoryObject.type` does not accept, so those ingests returned HTTP 500. The enum now mirrors
  the upstream pydantic literal, and a test asserts every advertised value is accepted.
- `patches/0001-hmr-service-routes-and-utf8.patch` (applied to the vendored copy, never to the
  submodule): the v2 routes (`/think`, `/best_decision`, `/feedback`, `/evolve`, `/ingest_image`)
  were defined after the `uvicorn.run(...)` guard, so they were never registered; emoji log lines
  also crashed on a GBK Windows console and turned `/evolve` into a 500 — stdout/stderr are now
  reconfigured to UTF-8 with `errors="replace"`.
- `HMR_STORAGE_PATH` pointing at a missing drive (a stale `I:\...` from another machine) no longer
  breaks the spawn; the plugin falls back to `~/.dsh-hmr/data` and warns.

### Notes

- `HF_HUB_OFFLINE=1` / `TRANSFORMERS_OFFLINE=1` (config `offline: true`) cuts startup from
  75s+ to a few seconds when the embedding model is already cached.
- Not related to `@deepseek-ai/dsh-hmr`, which is hot module replacement.
