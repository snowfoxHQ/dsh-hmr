import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HmrClient, HmrConnectionError } from '../src/index.js';
import { pythonAvailable, startService, type ServiceHandle } from './service-harness.js';

const hasPython = pythonAvailable();

describe.skipIf(!hasPython)('HmrClient against a real service', () => {
  let service: ServiceHandle;
  let client: HmrClient;

  beforeAll(async () => {
    service = await startService();
    client = new HmrClient({ baseUrl: service.baseUrl, timeoutMs: 60_000 });
    try {
      await client.waitForReady({ timeoutMs: 90_000, intervalMs: 500 });
    } catch (error) {
      // Never leak the child process when startup fails.
      await service.stop();
      throw error;
    }
  }, 180_000);

  afterAll(async () => {
    await service?.stop();
  }, 30_000);

  it('reports health with a version', async () => {
    const health = await client.health();
    expect(health.status).toBe('ok');
    expect(health.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('ingests a memory and recalls it by meaning', async () => {
    const marker = `vitest-marker-${Date.now()}`;

    const stored = await client.ingest({
      content: `The deployment pipeline uses Fernet keys. ${marker}`,
      memory_type: 'concept',
      title: 'Deployment key rotation',
      tags: ['deployment', 'security'],
    });

    expect(stored.id).toBeTruthy();
    expect(stored.title).toBe('Deployment key rotation');

    const recalled = await client.recall({
      query: 'how are deployment keys rotated',
      top_k: 5,
    });

    expect(recalled.memories.length).toBeGreaterThan(0);
    const hit = recalled.memories.find((memory) => memory.id === stored.id);
    expect(hit, 'ingested memory should be recalled').toBeDefined();
  }, 60_000);

  it('runs a thought chain and reflects on it', async () => {
    const result = await client.think({
      goal: 'Choose a storage layout for the test project',
      thoughts: [
        {
          type: 'observation',
          content: 'Two layouts are viable: per-project dirs or a single flat dir.',
          confidence: 0.8,
        },
        {
          type: 'decision',
          content: 'Go with per-project dirs to keep recall scoped.',
          confidence: 0.7,
        },
      ],
      actual_outcome: 'Per-project dirs kept recall scoped and cleaned up fine.',
      rating: 0.9,
    });

    expect(result.chain_id).toBeTruthy();
    expect(result.thought_count).toBe(2);
    expect(result.reflected).toBe(true);
  }, 60_000);

  it('exposes the v2.0 feedback / best_decision / evolve endpoints', async () => {
    const stored = await client.ingest({
      content: 'Feedback probe memory for policy learning.',
      memory_type: 'concept',
      title: 'Feedback probe',
    });

    const feedback = await client.feedback({
      event_type: 'task_success',
      memory_ids: [stored.id],
      signal: 0.8,
    });
    expect(feedback.recorded).toBe(true);

    const best = await client.bestDecision('a goal that was never attempted');
    expect(best).toHaveProperty('goal');

    const report = await client.evolve(true); // dry run
    expect(report).not.toBeNull();
  }, 60_000);

  it('returns a system status payload', async () => {
    const status = await client.status();
    expect(typeof status).toBe('object');
    expect(status).not.toBeNull();
  });

  it('classifies an unreachable service as a connection error', async () => {
    const dead = new HmrClient({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 1_000 });
    await expect(dead.health()).rejects.toBeInstanceOf(HmrConnectionError);
  }, 30_000);
});

describe.skipIf(hasPython)('HmrClient (skipped)', () => {
  it('requires python on PATH', () => {
    expect(hasPython).toBe(false);
  });
});
