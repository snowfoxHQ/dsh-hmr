/**
 * End-to-end tests against a real HMR service.
 *
 * The plugin runs in `managed` mode, so these tests also cover spawning,
 * readiness probing and SIGTERM teardown. Python + (pydantic, numpy, fastapi,
 * uvicorn) are required; without them the suite is skipped rather than failed.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import * as plugin from '../src/index.js';

interface RegisteredTool {
  name: string;
  description?: string;
  /** Compiled JSON Schema for the implicit object root. */
  parameters?: { properties?: Record<string, { enum?: string[] }> };
  execute: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

function pythonReady(): boolean {
  try {
    execFileSync('python', ['-c', 'import pydantic, numpy, fastapi, uvicorn'], {
      stdio: 'ignore',
      timeout: 30_000,
    });
    return true;
  } catch {
    return false;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

/** Minimal stand-in for the cordis context: captures tools and effect disposers. */
function createHarness(): {
  ctx: unknown;
  tools: Map<string, RegisteredTool>;
  dispose: () => Promise<void>;
} {
  const tools = new Map<string, RegisteredTool>();
  const disposers: (() => unknown)[] = [];
  const ctx = {
    tools: {
      register(tool: RegisteredTool) {
        tools.set(tool.name, tool);
      },
    },
    effect(register: () => () => unknown) {
      disposers.push(register());
    },
  };
  return {
    ctx,
    tools,
    dispose: async () => {
      for (const dispose of disposers) await dispose();
    },
  };
}

const available = pythonReady();

describe.skipIf(!available)('dsh-hmr plugin', () => {
  const storagePath = mkdtempSync(path.join(os.tmpdir(), 'dsh-hmr-plugin-'));
  const harness = createHarness();
  let port = 0;

  afterAll(async () => {
    await harness.dispose();
    rmSync(storagePath, { recursive: true, force: true });
  });

  it('declares a cordis plugin shape', () => {
    expect(plugin.name).toBe('dsh-hmr');
    expect(plugin.inject).toContain('tools');
  });

  it('registers the five hmr_* tools', async () => {
    port = await freePort();
    plugin.apply(harness.ctx as never, {
      process: 'managed',
      baseUrl: `http://127.0.0.1:${port}`,
      python: 'python',
      storagePath,
      startupTimeoutMs: 240_000,
      requestTimeoutMs: 120_000,
      offline: true,
    } as never);

    expect([...harness.tools.keys()].sort()).toEqual([
      'hmr_evolve',
      'hmr_ingest',
      'hmr_recall',
      'hmr_reflect',
      'hmr_think',
    ]);
  });

  it('spawns the service on first use', async () => {
    const tool = harness.tools.get('hmr_ingest');
    expect(tool).toBeDefined();
    const result = await tool!.execute({
      content: 'HMR 由插件以 managed 模式拉起，退出时 SIGTERM 回收。',
      title: 'managed lifecycle',
      memory_type: 'concept',
    });
    expect(result.id).toMatch(/^mem_/);
    expect(await portOpen(port)).toBe(true);
  });

  it('accepts every memory_type its own schema advertises', async () => {
    const ingest = harness.tools.get('hmr_ingest')!;
    const advertised = ingest.parameters?.properties?.['memory_type']?.enum ?? [];
    expect(advertised.length).toBeGreaterThan(0);

    for (const memoryType of advertised) {
      const result = await ingest.execute({
        content: `Memory type probe for ${memoryType}.`,
        title: `probe ${memoryType}`,
        memory_type: memoryType,
      });
      expect(result.type, `memory_type=${memoryType} was rejected`).toBe(memoryType);
    }
  });

  it('recalls what it ingested', async () => {
    const result = await harness.tools.get('hmr_recall')!.execute({
      query: '插件如何回收 HMR 服务进程',
      top_k: 5,
    });
    const memories = result.memories as { title: string; score: number }[];
    expect(memories.length).toBeGreaterThan(0);
    expect(memories.map((memory) => memory.title)).toContain('managed lifecycle');
    expect(typeof result.reasoning).toBe('string');
  });

  it('records a reasoning chain and reflects on it', async () => {
    const result = await harness.tools.get('hmr_reflect')!.execute({
      goal: 'pick a teardown signal',
      actual_outcome: 'SIGTERM with a SIGKILL fallback after 5s',
      rating: 0.9,
      thoughts: [{ content: 'SIGKILL loses pending writes', type: 'observation' }],
    });
    expect(result.chain_id).toMatch(/^tc_/);
    expect(result.reflected).toBe(true);
    expect(Array.isArray(result.insights)).toBe(true);
  });

  it('runs a dry-run evolution without mutating memory', async () => {
    const before = await harness.tools.get('hmr_recall')!.execute({
      query: 'managed lifecycle',
      top_k: 50,
    });
    const result = await harness.tools.get('hmr_evolve')!.execute({ dry_run: true });
    expect(result.dry_run).toBe(true);
    expect(result.report).toBeTypeOf('object');

    const after = await harness.tools.get('hmr_recall')!.execute({
      query: 'managed lifecycle',
      top_k: 50,
    });
    expect((after.memories as unknown[]).length).toBe((before.memories as unknown[]).length);
  });

  it('stops the managed service when disposed', async () => {
    await harness.dispose();
    await expect.poll(() => portOpen(port), { timeout: 15_000, interval: 250 }).toBe(false);
  });
});
