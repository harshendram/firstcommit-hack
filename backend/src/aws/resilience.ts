/**
 * Resilience primitives shared by every AWS call site.
 *
 * The SDK already retries throttles and 5xx (adaptive mode, see `clients.ts`).
 * What it does not do is stop hammering a region that is comprehensively down,
 * or fail over to a second region. That is what lives here:
 *
 *   breaker()  — per-dependency circuit breaker, so one sick dependency degrades
 *                that feature instead of stalling every voice turn behind it.
 *   withFailover() — try the primary region, trip to the secondary on the error
 *                classes that a region-wide problem actually produces.
 */

export type BreakerState = "closed" | "open" | "half_open";

interface BreakerOptions {
  /** Consecutive failures before the breaker opens. */
  threshold?: number;
  /** How long to stay open before letting one probe through. */
  cooldownMs?: number;
}

export class CircuitOpenError extends Error {
  constructor(name: string, retryInMs: number) {
    super(`${name} circuit is open; retry in ${Math.ceil(retryInMs / 1000)}s`);
    this.name = "CircuitOpenError";
  }
}

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private readonly threshold: number;
  private readonly cooldownMs: number;

  constructor(
    readonly name: string,
    { threshold = 5, cooldownMs = 30_000 }: BreakerOptions = {}
  ) {
    this.threshold = threshold;
    this.cooldownMs = cooldownMs;
  }

  get state(): BreakerState {
    if (this.failures < this.threshold) return "closed";
    return Date.now() - this.openedAt >= this.cooldownMs ? "half_open" : "open";
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      throw new CircuitOpenError(this.name, this.cooldownMs - (Date.now() - this.openedAt));
    }
    try {
      const result = await fn();
      if (this.failures > 0) {
        console.log(`[resilience] ${this.name} recovered after ${this.failures} failure(s)`);
      }
      this.failures = 0;
      return result;
    } catch (err) {
      this.failures += 1;
      if (this.failures === this.threshold) {
        this.openedAt = Date.now();
        console.error(
          `[resilience] ${this.name} circuit OPEN after ${this.failures} consecutive failures`
        );
      }
      throw err;
    }
  }
}

const breakers = new Map<string, CircuitBreaker>();

export function breaker(name: string, options?: BreakerOptions): CircuitBreaker {
  let existing = breakers.get(name);
  if (!existing) {
    existing = new CircuitBreaker(name, options);
    breakers.set(name, existing);
  }
  return existing;
}

export function breakerStates(): Record<string, BreakerState> {
  return Object.fromEntries([...breakers].map(([name, b]) => [name, b.state]));
}

/**
 * Errors that mean "this region cannot serve me right now" rather than
 * "this request was bad". Only these are worth a second region.
 */
const REGIONAL_FAILURES = new Set([
  "ThrottlingException",
  "TooManyRequestsException",
  "ServiceQuotaExceededException",
  "ServiceUnavailableException",
  "ServiceUnavailable",
  "InternalServerException",
  "InternalFailure",
  "ModelNotReadyException",
  "ModelTimeoutException",
  "RequestTimeout",
  "TimeoutError",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
]);

export function isRegionalFailure(err: unknown): boolean {
  const e = err as { name?: string; code?: string; $metadata?: { httpStatusCode?: number } };
  if (e?.name && REGIONAL_FAILURES.has(e.name)) return true;
  if (e?.code && REGIONAL_FAILURES.has(e.code)) return true;
  const status = e?.$metadata?.httpStatusCode;
  return status === 429 || (typeof status === "number" && status >= 500);
}

/**
 * Run against the primary region; on a region-shaped failure run the same work
 * against the secondary. The caller gets the region that actually served it so
 * it can be logged and surfaced on the dashboard.
 */
export async function withFailover<T>(
  label: string,
  primary: () => Promise<T>,
  secondary: () => Promise<T>
): Promise<{ result: T; failedOver: boolean }> {
  try {
    return { result: await primary(), failedOver: false };
  } catch (err) {
    if (!isRegionalFailure(err)) throw err;
    const reason = err instanceof Error ? err.name : String(err);
    console.warn(`[resilience] ${label} failing over to secondary region (${reason})`);
    return { result: await secondary(), failedOver: true };
  }
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
