import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { HmrClient } from '@dsh-hmr/hmr-client';
import type { HmrHealth } from '@dsh-hmr/hmr-client';

import type { ProcessMode } from './config.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** `dist/` -> package root */
function packageRoot(): string {
  return path.resolve(moduleDir, '..');
}

/** Root that must be on PYTHONPATH so `import hmr` resolves. */
export function bundledPythonRoot(): string {
  return path.join(packageRoot(), 'python');
}

/** Directory holding server.py. */
export function bundledServiceDir(): string {
  return path.join(bundledPythonRoot(), 'service');
}

export type LogFn = (level: 'info' | 'warn' | 'error', message: string) => void;

export interface ServiceManagerOptions {
  mode: ProcessMode;
  baseUrl: string;
  token?: string;
  python: string;
  serviceDir?: string;
  storagePath?: string;
  startupTimeoutMs: number;
  requestTimeoutMs: number;
  offline: boolean;
  log: LogFn;
}

/**
 * An on-disk path is only usable when its drive/root exists — a stale
 * `HMR_STORAGE_PATH=I:\...` from another machine otherwise fails the spawn.
 */
function isUsablePath(target: string): boolean {
  try {
    const root = path.parse(path.resolve(target)).root;
    return root.length > 0 && existsSync(root);
  } catch {
    return false;
  }
}

function defaultStoragePath(): string {
  return path.join(os.homedir(), '.dsh-hmr', 'data');
}

function splitBaseUrl(baseUrl: string): { host: string; port: string } {
  try {
    const url = new URL(baseUrl);
    return { host: url.hostname || '127.0.0.1', port: url.port || '8077' };
  } catch {
    return { host: '127.0.0.1', port: '8077' };
  }
}

/**
 * Owns the HMR service lifecycle.
 *
 * In `managed` mode the Python server is spawned on first use and killed when
 * the plugin is disposed. In `external` mode nothing is spawned — the caller is
 * expected to run the service itself.
 */
export class ServiceManager {
  readonly client: HmrClient;
  private readonly options: ServiceManagerOptions;
  private child: ChildProcess | null = null;
  private startup: Promise<HmrHealth> | null = null;
  private disposed = false;

  constructor(options: ServiceManagerOptions) {
    this.options = options;
    this.client = new HmrClient({
      baseUrl: options.baseUrl,
      ...(options.token ? { token: options.token } : {}),
      timeoutMs: options.requestTimeoutMs,
    });
  }

  /** Resolves once the service reports healthy. Safe to call repeatedly. */
  ready(): Promise<HmrHealth> {
    if (this.options.mode === 'external') {
      return this.probeExternal();
    }
    if (!this.startup) {
      this.startup = this.startManaged();
    }
    return this.startup;
  }

  private async probeExternal(): Promise<HmrHealth> {
    try {
      return await this.client.waitForReady({ timeoutMs: 15_000, intervalMs: 500 });
    } catch (error) {
      throw new Error(
        `dsh-hmr is in external mode but no HMR service answered at ${this.options.baseUrl}. ` +
          `Start it yourself (python server.py) or set process: managed.`,
        { cause: error },
      );
    }
  }

  private async startManaged(): Promise<HmrHealth> {
    if (this.disposed) {
      throw new Error('dsh-hmr service manager has been disposed');
    }

    const { host, port } = splitBaseUrl(this.options.baseUrl);
    const pythonRoot = bundledPythonRoot();
    const serviceDir = this.options.serviceDir ?? bundledServiceDir();
    const script = path.join(serviceDir, 'server.py');

    if (!existsSync(script)) {
      throw new Error(
        `HMR service script not found at ${script}. ` +
          `Run "npm run vendor:python" in the plugin package, or point config.serviceDir at a checkout of HMR.`,
      );
    }

    const configuredStorage = this.options.storagePath ?? process.env['HMR_STORAGE_PATH'];
    let storagePath: string;
    if (configuredStorage && isUsablePath(configuredStorage)) {
      storagePath = configuredStorage;
    } else {
      if (configuredStorage) {
        this.options.log(
          'warn',
          `ignoring HMR_STORAGE_PATH=${configuredStorage} (drive does not exist); using ${defaultStoragePath()}`,
        );
      }
      storagePath = defaultStoragePath();
    }
    mkdirSync(storagePath, { recursive: true });

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PYTHONPATH: [pythonRoot, process.env['PYTHONPATH']].filter(Boolean).join(path.delimiter),
      PYTHONIOENCODING: 'utf-8',
      PYTHONUNBUFFERED: '1',
      HMR_HOST: host,
      HMR_PORT: port,
      HMR_STORAGE_PATH: storagePath,
      ...(this.options.token ? { HMR_TOKEN: this.options.token } : {}),
      ...(this.options.offline ? { HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' } : {}),
    };

    this.options.log('info', `spawning HMR service on ${host}:${port} (storage: ${storagePath})`);

    const child = spawn(this.options.python, [script], {
      cwd: pythonRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;

    child.stdout?.on('data', (chunk: Buffer) => {
      this.options.log('info', chunk.toString().trimEnd());
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      this.options.log('warn', chunk.toString().trimEnd());
    });
    child.once('exit', (code, signal) => {
      if (!this.disposed && code !== 0) {
        this.options.log('error', `HMR service exited unexpectedly (code=${code}, signal=${signal})`);
      }
    });

    const spawnFailed = new Promise<never>((_resolve, reject) => {
      child.once('error', (error) => {
        reject(new Error(`failed to spawn "${this.options.python}": ${error.message}`, { cause: error }));
      });
    });

    try {
      return await Promise.race([
        this.client.waitForReady({
          timeoutMs: this.options.startupTimeoutMs,
          intervalMs: 500,
        }),
        spawnFailed,
      ]);
    } catch (error) {
      await this.stop();
      throw new Error(
        `HMR service did not become ready at ${this.options.baseUrl}. ` +
          `Check that pydantic, numpy, fastapi and uvicorn are installed for "${this.options.python}". ` +
          `If startup is slow because HuggingFace Hub is unreachable, set offline: true.`,
        { cause: error },
      );
    }
  }

  async stop(): Promise<void> {
    this.disposed = true;
    const child = this.child;
    this.child = null;
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 5_000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill();
    });
  }
}
