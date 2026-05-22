/**
 * Retry utility with exponential backoff.
 * Used for API calls that may fail due to rate limiting or transient errors.
 */

export interface RetryOptions {
  /** Maximum number of attempts (including the first). */
  maxAttempts: number;
  /** Initial delay in milliseconds before the first retry. */
  initialDelayMs: number;
  /** Multiplier applied to the delay after each retry. */
  backoffFactor: number;
  /** Maximum delay cap in milliseconds. */
  maxDelayMs: number;
  /** Optional predicate to determine if an error is retryable. */
  isRetryable?: (error: any) => boolean;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  backoffFactor: 2,
  maxDelayMs: 30000,
  isRetryable: defaultIsRetryable,
};

/**
 * Execute a function with retry logic and exponential backoff.
 *
 * @param fn - The async function to execute
 * @param options - Retry configuration
 * @returns The result of the function
 * @throws The last error if all retries are exhausted
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryOptions>
): Promise<T> {
  const opts: RetryOptions = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: any;
  let delay = opts.initialDelayMs;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // Check if we should retry
      const isRetryable = opts.isRetryable || defaultIsRetryable;
      if (attempt >= opts.maxAttempts || !isRetryable(error)) {
        throw error;
      }

      // Wait before retrying
      console.log(
        `[Kindle Scribe] Attempt ${attempt}/${opts.maxAttempts} failed, retrying in ${delay}ms...`,
        error.message
      );
      await sleep(delay);

      // Increase delay with backoff
      delay = Math.min(delay * opts.backoffFactor, opts.maxDelayMs);
    }
  }

  throw lastError;
}

/**
 * Default predicate for determining if an error is retryable.
 * Retries on network errors, timeouts, and 5xx/429 status codes.
 */
function defaultIsRetryable(error: any): boolean {
  // Network errors
  if (error.name === "TypeError" && error.message?.includes("fetch")) {
    return true;
  }

  // Timeout errors
  if (error.name === "AbortError" || error.message?.includes("timeout")) {
    return true;
  }

  // HTTP status-based retries
  const status = error.status || error.statusCode;
  if (status) {
    // Rate limited
    if (status === 429) return true;
    // Server errors
    if (status >= 500 && status < 600) return true;
  }

  // Check error message for common transient issues
  const msg = (error.message || "").toLowerCase();
  if (
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("socket hang up") ||
    msg.includes("network")
  ) {
    return true;
  }

  return false;
}

/** Simple sleep utility. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
