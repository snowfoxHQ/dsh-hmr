/** The HMR service answered, but with a non-2xx status. */
export class HmrError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(message: string, status: number, detail: string) {
    super(message);
    this.name = 'HmrError';
    this.status = status;
    this.detail = detail;
  }
}

/** The HMR service could not be reached at all (down, wrong port, DNS). */
export class HmrConnectionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'HmrConnectionError';
  }
}

/** The service is up but its vector index does not match the embedding provider. */
export class HmrIndexMismatchError extends HmrError {
  constructor(detail: string) {
    super(
      `HMR vector index does not match the current embedding provider. ` +
        `POST /reindex to rebuild, or restart the service after pinning the provider. ` +
        `(${detail})`,
      409,
      detail,
    );
    this.name = 'HmrIndexMismatchError';
  }
}
