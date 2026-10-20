import type { Context } from '@deepseek-ai/cordis';

import { Config, type Config as HmrConfig, type ProcessMode } from './config.js';
import { ServiceManager, type LogFn } from './service-process.js';
import { registerHmrTools } from './tools.js';

export { Config };
export type { HmrConfig };

/** Cordis plugin name. Must match the package name for loader resolution. */
export const name = 'dsh-hmr';

/** The tool registry is the only hard dependency. */
export const inject = ['tools'];

function makeLogger(): LogFn {
  return (level, message) => {
    const line = `[dsh-hmr] ${message}`;
    if (level === 'error') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
  };
}

/**
 * Mount the HMR cognitive memory tools.
 *
 * The Python service is spawned lazily: `apply` only schedules startup, so a
 * slow or broken HMR install never blocks harness boot.
 */
export function apply(ctx: Context, config: HmrConfig): void {
  const log = makeLogger();
  const mode: ProcessMode = config.process;

  const manager = new ServiceManager({
    mode,
    baseUrl: config.baseUrl,
    ...(config.token ? { token: config.token } : {}),
    python: config.python,
    ...(config.serviceDir ? { serviceDir: config.serviceDir } : {}),
    ...(config.storagePath ? { storagePath: config.storagePath } : {}),
    startupTimeoutMs: config.startupTimeoutMs,
    requestTimeoutMs: config.requestTimeoutMs,
    offline: config.offline,
    log,
  });

  registerHmrTools(ctx, {
    client: manager.client,
    ready: () => manager.ready(),
  });

  ctx.effect(() => {
    if (mode === 'managed') {
      // Warm the service in the background so the first tool call is not the
      // one paying the model-load cost. Errors surface again on first use.
      manager.ready().catch((error: unknown) => {
        log(
          'error',
          `background startup failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }
    return () => {
      void manager.stop();
    };
  });
}
