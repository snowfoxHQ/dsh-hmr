#!/usr/bin/env node
/**
 * Bundle the plugin into self-contained ESM files.
 *
 * `@dsh-hmr/hmr-client` is inlined, so the published package has no runtime
 * dependencies beyond the peer-provided harness packages. Declarations are
 * emitted separately by tsc (they may reference internal modules by path;
 * TypeScript resolves them even though only the bundle exists at runtime).
 */
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..');
process.chdir(packageRoot);

rmSync('dist', { recursive: true, force: true });

await build({
  entryPoints: ['src/index.ts', 'src/cli.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  sourcemap: true,
  // Supplied by the harness at runtime.
  external: ['@deepseek-ai/*'],
  logLevel: 'info',
});

console.log('[build] bundled dist/index.js and dist/cli.js (declarations emitted by tsc next)');
