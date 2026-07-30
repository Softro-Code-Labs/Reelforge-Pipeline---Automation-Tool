/** Options controlling {@link withRetry}'s backoff behavior. */
export interface RetryOptions {
  /** Maximum number of attempts, including the first. Default 3. */
  attempts?: number;
  /** Base delay in ms before the first retry; doubles each attempt. Default 500. */
  baseDelayMs?: number;
  /** Called before each retry, e.g. for logging. */
  onRetry?: (err: unknown, attempt: number) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `fn`, retrying with exponential backoff on failure. Used around
 * outbound calls to Gemini/Pexels/Freesound, which occasionally return
 * transient errors (rate limits, brief outages) that succeed on a second try.
 *
 * @throws The last error encountered, once all attempts are exhausted.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { attempts = 3, baseDelayMs = 500, onRetry } = options;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts) break;
      onRetry?.(err, attempt);
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw lastErr;
}
