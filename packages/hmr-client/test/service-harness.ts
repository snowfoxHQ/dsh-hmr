import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** packages/hmr-client/test -> repo root */
export const repoRoot = path.resolve(here, '../../..');
const vendoredRuntime = path.join(repoRoot, 'packages', 'dsh-hmr', 'python');
const vendorScript = path.join(repoRoot, 'packages', 'dsh-hmr', 'scripts', 'vendor-python.mjs');

/**
 * Tests boot the vendored copy the plugin ships, because `patches/*.patch` are
 * applied to it and not to the submodule. A fresh clone has no `python/` yet, so
 * generate it through the plugin's own script first — same bytes npm publishes.
 */
function resolveRuntime(): string {
  if (existsSync(path.join(vendoredRuntime, 'service', 'server.py'))) {
    return vendoredRuntime;
  }
  try {
    execFileSync(process.execPath, [vendorScript], { stdio: 'pipe' });
  } catch (error) {
    const detail = (error as { stderr?: Buffer }).stderr?.toString().trim();
    throw new Error(
      `could not vendor the HMR runtime — run "npm run build" at the repo root first.${detail ? `\n${detail}` : ''}`,
    );
  }
  return vendoredRuntime;
}

/** Root of the Python runtime under test (vendored copy, patches applied). */
export const hmrRepo = resolveRuntime();

export interface ServiceHandle {
  readonly port: number;
  readonly baseUrl: string;
  readonly storagePath: string;
  stop(): Promise<void>;
}

export function pythonAvailable(): boolean {
  try {
    execFileSync('python', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Boot the real HMR FastAPI service on a free-ish port with an isolated
 * storage directory, so tests never touch the developer's actual memories.
 */
export async function startService(): Promise<ServiceHandle> {
  const port = 18000 + Math.floor(Math.random() * 2000);
  const storagePath = mkdtempSync(path.join(os.tmpdir(), 'hmr-test-'));

  // sentence-transformers phones home to the HF Hub on every boot. When the
  // network is slow or blocked that retry ladder drags startup out to minutes.
  // Tests run offline against the local model cache unless explicitly opted out.
  const offline = process.env['HMR_TEST_ONLINE'] !== '1';

  const child: ChildProcess = spawn('python', ['service/server.py'], {
    cwd: hmrRepo,
    env: {
      ...process.env,
      HMR_HOST: '127.0.0.1',
      HMR_PORT: String(port),
      HMR_STORAGE_PATH: storagePath,
      HMR_TOKEN: '',
      ...(offline ? { HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
  });

  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    port,
    baseUrl,
    storagePath,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      child.kill();
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
      }, 5_000);
      try {
        await exited;
      } finally {
        clearTimeout(timer);
      }
      if (child.exitCode !== null && child.exitCode !== 0 && stderr.length > 0) {
        // Surface startup failures instead of hanging the suite.
        console.error('[hmr test harness] service stderr:\n', stderr);
      }
    },
  };
}
