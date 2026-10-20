# patches/

Fixes the plugin needs from the HMR service, expressed as patches instead of commits.

`vendor/hmr` is kept at a **pristine upstream commit** — never modified locally, never given local
commits. `plugins/dsh-hmr/scripts/vendor-python.mjs` copies `vendor/hmr/{hmr,service}` into
`plugins/dsh-hmr/python/` and then applies everything in this directory to **the copy**, so:

- the submodule pointer always matches `origin/main` of `snowfoxHQ/HMR`;
- `git -C vendor/hmr status` stays clean;
- published tarballs still contain the fixes.

## Applying

Automatic: `npm run build`, `npm run prepack` and `prepack` all run `vendor:python` first.

## Refreshing a patch

When the submodule moves and a patch no longer applies, `vendor:python` fails loudly with git's
rejection text. Re-derive the change against the new commit:

```bash
cd vendor/hmr                      # detached at the new upstream commit
# re-apply the fix by hand, then:
git diff > ../../patches/0001-hmr-service-routes-and-utf8.patch
git checkout .                     # leave the submodule clean again
```

## Contents

| Patch | Why |
| --- | --- |
| `0001-hmr-service-routes-and-utf8.patch` | v2.0 routes (`/think`, `/best_decision`, `/feedback`, `/evolve`, `/ingest_image`) were declared after a top-level `uvicorn.run(...)`, so their decorators never ran and the endpoints 404'd. Also reconfigures stdout/stderr to UTF-8, because an emoji log line raised `UnicodeEncodeError` on a GBK Windows console and turned `/evolve` into a 500. |

Both are upstream bugs, worth sending upstream as a PR — if they land, delete the patch.
