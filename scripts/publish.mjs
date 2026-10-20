#!/usr/bin/env node
/**
 * Publish both packages in dependency order, with the same gates a human would
 * want: clean tree → build → preflight → version not already on npm → publish →
 * verify what npm now serves.
 *
 *   npm run release:dry          # everything except the final upload
 *   npm run release              # real publish (latest tag)
 *   npm run release -- --tag next --otp 123456
 *   npm run release -- --registry https://registry.npmjs.org   # bypass a mirror registry
 *   npm run release -- --skip-checks   # no git/build/preflight, publish only
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Shared libraries live in `packages/`, dsh plugins in `plugins/`, skills in `skills/`. */
const PACKAGES = ['packages/hmr-client', 'plugins/dsh-hmr'];

const { values: flags } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    tag: { type: 'string', default: 'latest' },
    otp: { type: 'string' },
    registry: { type: 'string' },
    'skip-checks': { type: 'boolean', default: false },
    'skip-build': { type: 'boolean', default: false },
  },
  allowPositionals: false,
});

const dryRun = flags['dry-run'];
const skipChecks = flags['skip-checks'];

function runNpm(args, cwd) {
  const npmCli = process.env['npm_execpath'];
  const options = { cwd, stdio: 'inherit' };
  if (npmCli && npmCli.endsWith('.js')) {
    execFileSync(process.execPath, [npmCli, ...args], options);
    return;
  }
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    ...options,
    shell: process.platform === 'win32',
  });
}

function npmOutput(args) {
  const npmCli = process.env['npm_execpath'];
  const options = { cwd: repoRoot, encoding: 'utf8' };
  if (npmCli && npmCli.endsWith('.js')) {
    return execFileSync(process.execPath, [npmCli, ...args], options);
  }
  return execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    ...options,
    shell: process.platform === 'win32',
  });
}

function readPackage(dir) {
  return JSON.parse(readFileSync(path.join(repoRoot, dir, 'package.json'), 'utf8'));
}

/** Registry to publish to; defaults to whatever npm is configured with. */
const registry = flags.registry?.replace(/\/+$/, '') ?? null;

function npmArgs(args) {
  return registry ? [...args, '--registry', registry] : args;
}

/** Mirror registries are read-only for publishing; catching this early saves a confusing 403. */
const MIRROR_REGISTRY = /(npmmirror|taobao|cnpm|aliyun|tencent|huaweicloud)/i;

function configuredRegistry() {
  try {
    return npmOutput(['config', 'get', 'registry']).trim();
  } catch {
    return '(unknown)';
  }
}

/** `npm view` exits non-zero when the version does not exist yet. */
function publishedVersion(name, version) {
  try {
    const output = npmOutput(npmArgs(['view', `${name}@${version}`, 'version']));
    return output.trim() === version;
  } catch {
    return false;
  }
}

function assertCleanTree() {
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' });
  if (status.trim()) {
    console.error('refusing to publish from a dirty tree:\n' + status);
    process.exit(1);
  }
}

function assertLoggedIn() {
  try {
    const user = npmOutput(npmArgs(['whoami'])).trim();
    console.log(`npm user: ${user}`);
  } catch {
    console.error('not logged in to npm — run "npm login" first');
    process.exit(1);
  }
}

// --- gates -----------------------------------------------------------------

const packages = PACKAGES.map((dir) => {
  const pkg = readPackage(dir);
  return { dir, name: pkg.name, version: pkg.version, private: Boolean(pkg.private) };
});

const versions = new Set(packages.map((pkg) => pkg.version));
if (versions.size > 1) {
  console.error(`packages disagree on version: ${packages.map((pkg) => `${pkg.name}@${pkg.version}`).join(', ')}`);
  process.exit(1);
}
const version = packages[0].version;

for (const pkg of packages) {
  if (pkg.private) {
    console.error(`${pkg.name} is private`);
    process.exit(1);
  }
}

if (!skipChecks) {
  const target = registry ?? configuredRegistry();
  console.log(`registry: ${target}`);
  if (!registry && MIRROR_REGISTRY.test(target)) {
    console.error(
      `refusing to publish to a mirror registry (${target}).\n` +
        'Either pass an explicit target:\n' +
        '  npm run release -- --registry https://registry.npmjs.org\n' +
        'or pin the official registry for this repo:\n' +
        '  npm config set registry https://registry.npmjs.org --location=project',
    );
    process.exit(1);
  }
  assertCleanTree();
  assertLoggedIn();
}

if (!skipChecks && !flags['skip-build']) {
  console.log(`\n=== build (${version}) ===`);
  runNpm(['run', 'build'], repoRoot);
}

if (!skipChecks) {
  console.log('\n=== preflight ===');
  runNpm(['run', 'preflight'], repoRoot);
}

// --- publish ---------------------------------------------------------------

for (const pkg of packages) {
  if (publishedVersion(pkg.name, pkg.version)) {
    console.error(`\n${pkg.name}@${pkg.version} already exists on npm — bump both packages first`);
    process.exit(1);
  }
}

const published = [];

for (const pkg of packages) {
  const args = ['publish', '--tag', flags.tag];
  if (pkg.name.startsWith('@')) args.push('--access', 'public');
  if (flags.otp) args.push('--otp', flags.otp);

  console.log(`\n=== ${dryRun ? 'dry-run ' : ''}publish ${pkg.name}@${pkg.version} (tag: ${flags.tag}) ===`);
  try {
    runNpm(npmArgs(dryRun ? [...args, '--dry-run'] : args), path.join(repoRoot, pkg.dir));
  } catch {
    console.error(
      `\npublish failed for ${pkg.name}.\n` +
        (pkg.name.startsWith('@')
          ? 'Scoped packages need an @dsh-hmr org you can write to — check "npm access ls-packages".\n'
          : '') +
        'If both packages share a version, the first one may already be live; release the remaining one with --skip-checks.',
    );
    process.exit(1);
  }
  published.push(pkg);
}

if (!dryRun) {
  console.log('\n=== verify ===');
  for (const pkg of published) {
    const ok = publishedVersion(pkg.name, pkg.version);
    console.log(`  ${ok ? '✓' : '✗'} ${pkg.name}@${pkg.version}`);
    if (!ok) process.exitCode = 1;
  }
}

console.log(
  `\n${dryRun ? 'dry run complete' : `published ${published.map((pkg) => `${pkg.name}@${pkg.version}`).join(', ')}`}` +
    `\nmount it with: dsh plugin --profile <name> add dsh-hmr`,
);
