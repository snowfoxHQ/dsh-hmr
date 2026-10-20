/**
 * Wire types mirroring the HMR FastAPI service (`vendor/hmr/service/server.py`).
 * Keep these in sync with the service Pydantic models.
 */

export type HmrServiceStatus = 'ok' | 'degraded' | 'starting';

export interface HmrHealth {
  status: HmrServiceStatus;
  version: string;
  embedding_provider?: string;
  total_memories?: number;
  synced?: boolean;
  warning?: string;
}

export interface HmrIngestInput {
  content: string;
  memory_type?: string;
  title?: string;
  tags?: string[];
  confidence?: number;
  use_policy?: boolean;
}

export interface HmrIngestResult {
  id: string;
  type: string;
  title: string;
  summary: string | null;
}

export interface HmrRecallInput {
  query: string;
  top_k?: number;
  strategy?: string | null;
  use_policy?: boolean;
}

export interface HmrMemory {
  id: string;
  type: string;
  title: string;
  content: string;
  summary: string | null;
  score: number;
}

export interface HmrRecallResult {
  reasoning: string;
  memories: HmrMemory[];
}

export interface HmrSaveStateInput {
  goal?: string | null;
  plan?: string[] | null;
  context?: Record<string, unknown> | null;
}

export interface HmrSaveStateResult {
  runtime_id: string;
  goal: string;
}

export interface HmrRestoreStateResult {
  restored: boolean;
  runtime_id?: string;
  goal?: string;
  plan?: string[];
  context?: Record<string, unknown>;
}

export interface HmrReindexResult {
  reindexed: boolean;
  memory_count: number;
  embedding_provider: string;
  message: string;
}

export type HmrThoughtType =
  | 'observation'
  | 'hypothesis'
  | 'decision'
  | 'action'
  | 'insight';

export interface HmrThoughtInput {
  content: string;
  type?: HmrThoughtType;
  confidence?: number;
}

export interface HmrThinkInput {
  goal: string;
  thoughts?: HmrThoughtInput[];
  actual_outcome?: string;
  rating?: number;
}

export interface HmrThinkResult {
  chain_id: string;
  goal: string;
  thought_count: number;
  reflected: boolean;
  insights: string[];
  suggested_memory: string | null;
}

export interface HmrBestDecisionResult {
  goal: string;
  best_decision: string | null;
}

export type HmrFeedbackEvent =
  | 'recall_hit'
  | 'recall_miss'
  | 'task_success'
  | 'task_failure';

export interface HmrFeedbackInput {
  event_type: HmrFeedbackEvent;
  memory_ids: string[];
  signal: number;
  query?: string;
  strategy?: string;
}

export interface HmrFeedbackResult {
  recorded: boolean;
  event_type: string;
  signal: number;
}

export interface HmrEvolveReport {
  [key: string]: unknown;
}

export interface HmrIngestImageInput {
  image_path?: string;
  image_base64?: string;
  title?: string;
  tags?: string[];
  prompt?: string;
  model?: string;
  memory_type?: string;
}

export interface HmrIngestImageResult {
  id: string;
  title: string;
  description: string;
  origin_path: string | null;
  model: string;
}

/** Full system status; shape is owned by the Python runtime and may grow. */
export type HmrSystemStatus = Record<string, unknown>;

export interface HmrClientOptions {
  /** Defaults to `HMR_BASE_URL` env, then `http://127.0.0.1:8077`. */
  baseUrl?: string;
  /** Defaults to `HMR_TOKEN` env. Sent as `x-hmr-token`. */
  token?: string;
  /** Per-request timeout in ms. Defaults to 120000. */
  timeoutMs?: number;
}
