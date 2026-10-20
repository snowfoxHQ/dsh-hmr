#!/usr/bin/env node
/**
 * Copy the HMR Python runtime from `vendor/hmr` into `plugins/dsh-hmr/python`
 * so the published npm tarball is self-contained.
 *
 * PYTHONPATH points at `python/`, so `import hmr` works without `pip install`.
 *
 * `vendor/hmr` stays a pristine upstream checkout: local fixes that the plugin
 * depends on live in `patches/*.patch` and are applied to the copy, never to
 * the submodule. See `patches/README.md`.
 */
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..');
const repoRoot = path.resolve(packageRoot, '..', '..');
const source = path.join(repoRoot, 'vendor', 'hmr');
const patchesDir = path.join(repoRoot, 'patches');
const destination = path.join(packageRoot, 'python');

// DSH-HMR-NOTE: keep symlinks out; HMR is plain files.
const skipJunk = (file) =>
  !file.includes('__pycache__') &&
  !file.endsWith('.pyc') &&
  !file.endsWith('.egg-info');

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function patchFiles() {
  if (!(await exists(patchesDir))) return [];
  const entries = await readdir(patchesDir);
  return entries.filter((entry) => entry.endsWith('.patch')).sort();
}

/**
 * Apply every patch in lexical order. `--directory` rewrites the `a/service/...`
 * paths from the patch onto the vendored copy, so the submodule is untouched.
 */
function applyPatches(files) {
  for (const file of files) {
    const patchPath = path.join(patchesDir, file);
    try {
      execFileSync(
        'git',
        [
          'apply',
          '--directory',
          'plugins/dsh-hmr/python',
          '--whitespace=nowarn',
          patchPath,
        ],
        { cwd: repoRoot, stdio: 'pipe' },
      );
    } catch (error) {
      const detail = error?.stderr?.toString().trim() || error.message;
      console.error(
        `[vendor-python] failed to apply ${file}:\n${detail}\n` +
          `The patch probably no longer matches vendor/hmr — refresh it against the current submodule commit.`,
      );
      process.exit(1);
    }
    console.log(`[vendor-python] applied ${file}`);
  }
}

if (!(await exists(source))) {
  console.error(
    `[vendor-python] HMR checkout missing at ${source}\n` +
      `Run: git submodule update --init --recursive`,
  );
  process.exit(1);
}

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });

const copies = [
  ['hmr', 'hmr'],
  ['service', 'service'],
];

for (const [from, to] of copies) {
  const src = path.join(source, from);
  if (!(await exists(src))) {
    console.error(`[vendor-python] expected ${src} to exist`);
    process.exit(1);
  }
  await cp(src, path.join(destination, to), {
    recursive: true,
    filter: skipJunk,
  });
}

const license = path.join(source, 'LICENSE');
if (await exists(license)) {
  await cp(license, path.join(destination, 'LICENSE'));
}

applyPatches(await patchFiles());

console.log(`[vendor-python] copied HMR runtime into ${destination}`);
