import z from '@deepseek-ai/schemastery';

/** How the HMR service process is obtained. */
export type ProcessMode = 'managed' | 'external';

/**
 * Plugin configuration. Everything is optional except the mode choice: the
 * defaults are meant to work on a clean machine with only Python + pip deps.
 */
export const Config = z.object({
  process: z
    .union([z.const('managed'), z.const('external')])
    .default('managed')
    .description(
      'managed = spawn and supervise the Python service; external = connect to an already-running one.',
    ),
  baseUrl: z
    .string()
    .default('http://127.0.0.1:8077')
    .description('HMR service base URL. Host and port are reused when spawning.'),
  token: z
    .string()
    .role('secret')
    .description('Shared secret forwarded as x-hmr-token / HMR_TOKEN.'),
  python: z.string().default('python').description('Python executable used to spawn the service.'),
  serviceDir: z
    .string()
    .description('Directory containing server.py. Defaults to the copy bundled with this package.'),
  storagePath: z
    .string()
    .description('HMR data directory. Defaults to ~/.dsh-hmr/data.'),
  startupTimeoutMs: z
    .number()
    .default(180_000)
    .description('How long to wait for the service to answer /health on first startup.'),
  requestTimeoutMs: z
    .number()
    .default(120_000)
    .description('Per-request timeout for tool calls.'),
  offline: z
    .boolean()
    .default(false)
    .description(
      'Set HF_HUB_OFFLINE=1 for the service, skipping HuggingFace Hub metadata lookups. ' +
        'Recommended when the model is already cached and the network is slow.',
    ),
});

export interface Config {
  process: ProcessMode;
  baseUrl: string;
  token?: string;
  python: string;
  serviceDir?: string;
  storagePath?: string;
  startupTimeoutMs: number;
  requestTimeoutMs: number;
  offline: boolean;
}
