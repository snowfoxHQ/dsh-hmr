#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import { bundledPythonRoot, bundledServiceDir } from './service-process.js';

const USAGE = `dsh-hmr — HMR cognitive memory for DeepSeek Harness

Usage:
  dsh-hmr doctor           Check the local Python environment and bundled runtime
  dsh-hmr serve [args...]  Run the HMR service in the foreground
  dsh-hmr env              Print the environment the plugin would use
  dsh-hmr --help           Show this message

The plugin itself is mounted through dsh:
  dsh plugin --profile web add dsh-hmr
`;

function pythonBin(): string {
  return process.env['DSH_HMR_PYTHON'] ?? 'python';
}

function which(command: string, args: string[]): { ok: boolean; output: string } {
  try {
    const output = execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, output: output.trim() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, output: message };
  }
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function doctor(): Promise<number> {
  let failures = 0;
  const report = (label: string, ok: boolean, detail: string) => {
    if (!ok) failures += 1;
    console.log(`${ok ? 'OK  ' : 'FAIL'}  ${label}: ${detail}`);
  };

  const python = pythonBin();
  const version = which(python, ['--version']);
  report('python', version.ok, version.ok ? version.output : `${python} not runnable`);

  if (version.ok) {
    const deps = which(python, [
      '-c',
      'import pydantic, numpy, fastapi, uvicorn; print("deps-ok")',
    ]);
    report(
      'python deps',
      deps.ok,
      deps.ok ? 'pydantic, numpy, fastapi, uvicorn present' : 'run: pip install pydantic numpy fastapi uvicorn',
    );

    const optional = which(python, ['-c', 'import sentence_transformers; print("st-ok")']);
    console.log(
      `${optional.ok ? 'OK  ' : 'WARN'}  embeddings: ${
        optional.ok ? 'sentence-transformers available' : 'falls back to TF-IDF'
      }`,
    );
  }

  const serviceDir = bundledServiceDir();
  const script = path.join(serviceDir, 'server.py');
  report('bundled runtime', existsSync(script), script);
  report('python root', existsSync(bundledPythonRoot()), bundledPythonRoot());

  const free = await portFree(8077);
  console.log(`${free ? 'OK  ' : 'WARN'}  port 8077: ${free ? 'free' : 'already in use (use process: external)'}`);

  console.log(failures === 0 ? '\nEnvironment looks good.' : `\n${failures} check(s) failed.`);
  return failures === 0 ? 0 : 1;
}

function env(): number {
  const pythonRoot = bundledPythonRoot();
  console.log(
    [
      `DSH_HMR_PYTHON=${pythonBin()}`,
      `PYTHONPATH=${[pythonRoot, process.env['PYTHONPATH']].filter(Boolean).join(path.delimiter)}`,
      `HMR_STORAGE_PATH=${process.env['HMR_STORAGE_PATH'] ?? '(unset)'}`,
      `HMR_TOKEN=${process.env['HMR_TOKEN'] ? '(set)' : '(unset)'}`,
    ].join('\n'),
  );
  return 0;
}

function serve(extra: string[]): void {
  const script = path.join(bundledServiceDir(), 'server.py');
  if (!existsSync(script)) {
    console.error(`dsh-hmr: service script missing at ${script}`);
    console.error('Run "npm run vendor:python" in the plugin package.');
    process.exit(1);
  }
  // Foreground: inherit stdio so Ctrl-C works naturally.
  const proc = spawn(pythonBin(), [script, ...extra], {
    cwd: bundledPythonRoot(),
    env: {
      ...process.env,
      PYTHONPATH: [bundledPythonRoot(), process.env['PYTHONPATH']].filter(Boolean).join(path.delimiter),
      PYTHONIOENCODING: 'utf-8',
    },
    stdio: 'inherit',
  });
  proc.on('exit', (code) => process.exit(code ?? 0));
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case 'doctor':
      process.exit(await doctor());
      break;
    case 'serve':
      serve(rest);
      break;
    case 'env':
      process.exit(env());
      break;
    case undefined:
    case '--help':
    case '-h':
      console.log(USAGE);
      break;
    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(USAGE);
      process.exit(1);
  }
}

void main();
