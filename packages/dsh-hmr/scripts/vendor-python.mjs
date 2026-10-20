#!/usr/bin/env node
/**
 * Copy the HMR Python runtime from `vendor/hmr` into `packages/dsh-hmr/python`
 * so the published npm tarball is self-contained.
 *
 * PYTHONPATH points at `python/`, so `import hmr` works without `pip install`.
 */
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..');
const repoRoot = path.resolve(packageRoot, '..', '..');
const source = path.join(repoRoot, 'vendor', 'hmr');
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

console.log(`[vendor-python] copied HMR runtime into ${destination}`);
