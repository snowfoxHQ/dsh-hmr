import { HmrConnectionError, HmrError, HmrIndexMismatchError } from './errors.js';
import type {
  HmrBestDecisionResult,
  HmrClientOptions,
  HmrEvolveReport,
  HmrFeedbackInput,
  HmrFeedbackResult,
  HmrHealth,
  HmrIngestImageInput,
  HmrIngestImageResult,
  HmrIngestInput,
  HmrIngestResult,
  HmrRecallInput,
  HmrRecallResult,
  HmrReindexResult,
  HmrRestoreStateResult,
  HmrSaveStateInput,
  HmrSaveStateResult,
  HmrSystemStatus,
  HmrThinkInput,
  HmrThinkResult,
} from './types.js';

const DEFAULT_BASE_URL = 'http://127.0.0.1:8077';
const DEFAULT_TIMEOUT_MS = 120_000;
const HEALTH_TIMEOUT_MS = 5_000;

interface RequestInitLite {
  method?: string;
  body?: unknown;
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  return String(cause);
}

function extractDetail(payload: unknown): string | null {
  if (typeof payload === 'string' && payload.length > 0) {
    return payload;
  }
  if (payload && typeof payload === 'object' && 'detail' in payload) {
    const detail = (payload as { detail: unknown }).detail;
    if (typeof detail === 'string') {
      return detail;
    }
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface WaitForReadyOptions {
  /** Total time to wait. Defaults to 60000 ms. */
  timeoutMs?: number;
  /** Poll interval. Defaults to 1000 ms. */
  intervalMs?: number;
}

/**
 * Thin, typed wrapper over the HMR HTTP service.
 *
 * Zero runtime dependencies: uses the global `fetch` available in Node 18+.
 */
export class HmrClient {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  private readonly token: string | undefined;

  constructor(options: HmrClientOptions = {}) {
    const base = options.baseUrl ?? process.env['HMR_BASE_URL'] ?? DEFAULT_BASE_URL;
    this.baseUrl = base.replace(/\/+$/, '');

    const token = options.token ?? process.env['HMR_TOKEN'];
    this.token = token && token.length > 0 ? token : undefined;

    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** GET /health */
  health(timeoutMs: number = HEALTH_TIMEOUT_MS): Promise<HmrHealth> {
    return this.request<HmrHealth>('/health', {}, timeoutMs);
  }

  /** True when the service answers /health at all (regardless of status field). */
  async isReachable(): Promise<boolean> {
    try {
      await this.health();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Poll /health until the service reports `ok` or `degraded`.
   * Useful right after spawning the Python process in managed mode.
   */
  async waitForReady(options: WaitForReadyOptions = {}): Promise<HmrHealth> {
    const timeoutMs = options.timeoutMs ?? 60_000;
    const intervalMs = options.intervalMs ?? 1_000;
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;

    while (Date.now() < deadline) {
      try {
        const remaining = Math.max(1_000, deadline - Date.now());
        const health = await this.health(Math.min(HEALTH_TIMEOUT_MS, remaining));
        if (health.status === 'ok' || health.status === 'degraded') {
          return health;
        }
      } catch (error) {
        lastError = error;
      }
      await delay(intervalMs);
    }

    throw new HmrConnectionError(
      `HMR service did not become ready within ${timeoutMs}ms at ${this.baseUrl}`,
      { cause: lastError },
    );
  }

  /** POST /ingest */
  ingest(input: HmrIngestInput): Promise<HmrIngestResult> {
    return this.request<HmrIngestResult>('/ingest', { method: 'POST', body: input });
  }

  /** POST /recall */
  recall(input: HmrRecallInput): Promise<HmrRecallResult> {
    return this.request<HmrRecallResult>('/recall', { method: 'POST', body: input });
  }

  /** POST /save_state */
  saveState(input: HmrSaveStateInput): Promise<HmrSaveStateResult> {
    return this.request<HmrSaveStateResult>('/save_state', { method: 'POST', body: input });
  }

  /** GET /restore_state */
  restoreState(): Promise<HmrRestoreStateResult> {
    return this.request<HmrRestoreStateResult>('/restore_state');
  }

  /** GET /status */
  status(): Promise<HmrSystemStatus> {
    return this.request<HmrSystemStatus>('/status');
  }

  /** POST /reindex */
  reindex(): Promise<HmrReindexResult> {
    return this.request<HmrReindexResult>('/reindex', { method: 'POST' });
  }

  /** POST /think */
  think(input: HmrThinkInput): Promise<HmrThinkResult> {
    return this.request<HmrThinkResult>('/think', { method: 'POST', body: input });
  }

  /** GET /best_decision */
  bestDecision(goal: string): Promise<HmrBestDecisionResult> {
    return this.request<HmrBestDecisionResult>(
      `/best_decision${this.queryString({ goal })}`,
    );
  }

  /** POST /feedback */
  feedback(input: HmrFeedbackInput): Promise<HmrFeedbackResult> {
    return this.request<HmrFeedbackResult>('/feedback', { method: 'POST', body: input });
  }

  /** POST /evolve */
  evolve(dryRun: boolean = false): Promise<HmrEvolveReport> {
    return this.request<HmrEvolveReport>(
      `/evolve${this.queryString({ dry_run: dryRun })}`,
      { method: 'POST' },
    );
  }

  /** POST /ingest_image */
  ingestImage(input: HmrIngestImageInput): Promise<HmrIngestImageResult> {
    return this.request<HmrIngestImageResult>('/ingest_image', {
      method: 'POST',
      body: input,
    });
  }

  private queryString(params: Record<string, string | number | boolean | undefined>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        search.set(key, String(value));
      }
    }
    const rendered = search.toString();
    return rendered.length > 0 ? `?${rendered}` : '';
  }

  private async request<T>(
    path: string,
    init: RequestInitLite = {},
    timeoutMs: number = this.timeoutMs,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = { accept: 'application/json' };
    if (init.body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    if (this.token) {
      headers['x-hmr-token'] = this.token;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: init.method ?? 'GET',
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      throw new HmrConnectionError(
        `Cannot reach HMR service at ${url}. Is it running? (${describeCause(cause)})`,
        { cause },
      );
    }

    const raw = await response.text();
    let payload: unknown = null;
    if (raw.length > 0) {
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = raw;
      }
    }

    if (!response.ok) {
      const detail = extractDetail(payload) ?? response.statusText;
      if (response.status === 409) {
        throw new HmrIndexMismatchError(detail);
      }
      throw new HmrError(`HMR ${response.status} on ${path}: ${detail}`, response.status, detail);
    }

    return payload as T;
  }
}
