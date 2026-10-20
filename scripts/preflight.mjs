#!/usr/bin/env node
/**
 * Pre-publish gate for both packages.
 *
 * Checks metadata, asserts the tarball contains what users need (and none of the
 * build leftovers), then unpacks each tarball and imports its entry point to
 * catch broken relative imports that only show up once published.
 *
 * Usage: npm run preflight   (run `npm run build` first, or use `npm run release:dry`)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Publish order matters: the plugin bundles the client, but both ship together. */
const PACKAGES = [
  {
    dir: 'packages/hmr-client',
    required: [
      'package.json',
      'README.md',
      'LICENSE',
      'dist/index.js',
      'dist/index.d.ts',
    ],
    entry: 'dist/index.js',
  },
  {
    dir: 'plugins/dsh-hmr',
    required: [
      'package.json',
      'README.md',
      'LICENSE',
      'cordis.patch.yml',
      'dist/index.js',
      'dist/index.d.ts',
      'dist/cli.js',
      'python/service/server.py',
      'python/hmr/__init__.py',
      'python/LICENSE',
    ],
    entry: 'dist/index.js',
  },
];

const FORBIDDEN = [
  { pattern: /(^|\/)node_modules\//, why: 'node_modules must never ship' },
  { pattern: /^src\//, why: 'sources are not part of the tarball' },
  { pattern: /^test\//, why: 'tests are not part of the tarball' },
  { pattern: /__pycache__/, why: 'python bytecode cache' },
  { pattern: /\.pyc$/, why: 'python bytecode' },
  { pattern: /\.egg-info/, why: 'editable install leftovers' },
  { pattern: /\.tsbuildinfo$/, why: 'tsc incremental state' },
  { pattern: /(^|\/)tsconfig\.json$/, why: 'build config, not runtime' },
  { pattern: /(^|\/)\.DS_Store$/, why: 'macOS noise' },
];

const BASE_FIELDS = ['name', 'version', 'description', 'license', 'files'];

const errors = [];
const warnings = [];
const summary = [];

function runNpm(args, cwd) {
  const npmCli = process.env['npm_execpath'];
  const options = { cwd, encoding: 'utf8' };
  if (npmCli && npmCli.endsWith('.js')) {
    return execFileSync(process.execPath, [npmCli, ...args], options);
  }
  return execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    ...options,
    shell: process.platform === 'win32',
  });
}

function hasTar() {
  const result = spawnSync('tar', ['--version'], { encoding: 'utf8' });
  return result.status === 0;
}

/**
 * `npm pack --json` interleaves the stdout of the `prepack` lifecycle script with
 * its own JSON, so the payload has to be located rather than assumed to start at
 * byte 0. Walking backwards for a parseable array is the cheapest reliable way.
 */
function parseTrailingJson(text) {
  const clean = text.replace(/\u001b\[[0-9;]*m/g, '');
  for (let index = clean.length - 1; index >= 0; index -= 1) {
    if (clean[index] !== '[') continue;
    try {
      const parsed = JSON.parse(clean.slice(index));
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Not the start of the payload; keep looking.
    }
  }
  throw new Error(`no JSON array found in npm pack output:\n${clean.slice(-400)}`);
}

function checkMetadata(pkg, dir) {
  for (const field of BASE_FIELDS) {
    if (!pkg[field]) errors.push(`${pkg.name}: missing "${field}" in package.json`);
  }
  if (!Array.isArray(pkg.files) || pkg.files.length === 0) {
    errors.push(`${pkg.name}: "files" must list what ships`);
  }
  if (!pkg.repository && !pkg.homepage) {
    warnings.push(`${pkg.name}: no repository/homepage — npm page will look empty`);
  }
  if (pkg.private) errors.push(`${pkg.name}: marked private, npm publish will refuse`);

  const entry = PACKAGES.find((candidate) => candidate.dir === dir).entry;
  if (!existsSync(path.join(repoRoot, dir, entry))) {
    errors.push(`${pkg.name}: ${entry} is missing — run "npm run build" first`);
  }
}

function checkTarball(pkg, files, spec) {
  const names = files.map((file) => file.path.replace(/\\/g, '/'));
  const include = new Set(names);

  for (const required of spec.required) {
    if (!include.has(required)) {
      errors.push(`${pkg.name}: tarball is missing "${required}"`);
    }
  }

  for (const name of names) {
    for (const rule of FORBIDDEN) {
      if (rule.pattern.test(name)) {
        errors.push(`${pkg.name}: tarball contains "${name}" (${rule.why})`);
      }
    }
  }

  const allowed = /(\.(py|txt|md|json|csv|yaml|yml|cfg|toml|bat|sh|in|example|typed)|(^|\/)(LICENSE|NOTICE))$/i;
  const stray = names.filter((name) => name.startsWith('python/') && !allowed.test(name));
  if (stray.length > 0) {
    warnings.push(`${pkg.name}: ${stray.length} unexpected file(s) under python/, e.g. ${stray.slice(0, 3).join(', ')}`);
  }

  const size = files.reduce((total, file) => total + (file.size ?? 0), 0);
  return { count: names.length, size };
}

/**
 * `python/` must be the patched copy: UTF-8 streams, and the `uvicorn.run` entry
 * block moved to the end of the module so the v2 routes get registered.
 */
function checkVendoredPatch() {
  const server = path.join(repoRoot, 'plugins/dsh-hmr/python/service/server.py');
  if (!existsSync(server)) return;
  const lines = readFileSync(server, 'utf8').split('\n');
  const runAt = lines.findIndex((line) => /^if __name__ == ["']__main__["']:/.test(line));
  const patched =
    lines.some((line) => line.includes('reconfigure(')) &&
    runAt >= 0 &&
    runAt >= lines.length - 20;

  if (!patched) {
    errors.push(
      'dsh-hmr: python/service/server.py is missing the patches/0001 routes+UTF-8 fix — ' +
        'run "npm run vendor:python" to rebuild the vendored copy',
    );
  }
}

function checkSubmoduleClean() {
  const result = spawnSync('git', ['-C', path.join(repoRoot, 'vendor/hmr'), 'status', '--porcelain'], {
    encoding: 'utf8',
  });
  if (result.status === 0 && result.stdout.trim()) {
    errors.push('vendor/hmr has local changes — the submodule must stay pristine (use patches/ instead)');
  }
}

function verifyImport(pkg, tarball, spec) {
  const scratch = mkdtempSync(path.join(repoRoot, '.pack-verify-'));
  try {
    const untar = spawnSync('tar', ['-xzf', tarball, '-C', scratch], { encoding: 'utf8' });
    if (untar.status !== 0) {
      warnings.push(`${pkg.name}: could not unpack tarball (${untar.stderr?.trim() ?? 'tar failed'}), skipped import check`);
      return;
    }
    const extracted = path.join(scratch, 'package');
    const entry = path.join(extracted, spec.entry);
    if (!existsSync(entry)) {
      errors.push(`${pkg.name}: extracted tarball has no ${spec.entry}`);
      return;
    }
    const moduleUrl = pathToFileURL(entry).href;
    const script = `import(${JSON.stringify(moduleUrl)}).then(m => {
      const keys = Object.keys(m);
      if (keys.length === 0) { console.error('NO_EXPORTS'); process.exit(3); }
      console.log(keys.join(','));
    }).catch(e => { console.error(e.message); process.exit(2); });`;
    const probe = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: extracted,
      encoding: 'utf8',
      env: { ...process.env, NODE_PATH: path.join(repoRoot, 'node_modules') },
    });
    if (probe.status !== 0) {
      errors.push(`${pkg.name}: importing ${spec.entry} from the tarball failed: ${probe.stderr.trim() || probe.stdout.trim()}`);
    } else {
      summary[summary.length - 1].exports = probe.stdout.trim();
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// --- run -------------------------------------------------------------------

const versions = new Set();
const tarAvailable = hasTar();
if (!tarAvailable) warnings.push('tar is unavailable — skipping tarball unpack/import verification');

for (const spec of PACKAGES) {
  const dir = path.join(repoRoot, spec.dir);
  const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  versions.add(pkg.version);
  checkMetadata(pkg, spec.dir);

  const listed = parseTrailingJson(runNpm(['pack', '--dry-run', '--json', '--silent'], dir));
  const files = listed[0]?.files ?? [];
  const stats = checkTarball(pkg, files, spec);
  summary.push({ name: pkg.name, version: pkg.version, ...stats, exports: '—' });

  if (tarAvailable) {
    const outDir = mkdtempSync(path.join(os.tmpdir(), 'dsh-hmr-pack-'));
    try {
      const packed = parseTrailingJson(
        runNpm(['pack', '--json', '--silent', '--pack-destination', outDir], dir),
      );
      const filename = packed[0]?.filename;
      const tarball = filename ? path.join(outDir, filename) : null;
      if (tarball && existsSync(tarball)) verifyImport(pkg, tarball, spec);
      else errors.push(`${pkg.name}: "npm pack" produced no tarball`);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }
}

if (versions.size > 1) {
  errors.push(`packages disagree on version: ${[...versions].join(', ')} — bump both together`);
}

checkVendoredPatch();
checkSubmoduleClean();

for (const entry of summary) {
  const kb = (entry.size / 1024).toFixed(1);
  console.log(`  ${entry.name}@${entry.version}  ${entry.count} files  ${kb} kB  exports: ${entry.exports}`);
}
for (const warning of warnings) console.warn(`  warn  ${warning}`);

if (errors.length > 0) {
  console.error(`\npreflight failed (${errors.length}):`);
  for (const error of errors) console.error(`  ✗ ${error}`);
  process.exit(1);
}

console.log(`\npreflight ok — ${summary.length} package(s) ready to publish`);
