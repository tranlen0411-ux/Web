// supabase/functions/competition-capability-token-issuer/rate-limit.ts
import { Redis } from 'https://esm.sh/@upstash/redis@1.34.3';
import { Ratelimit } from 'https://esm.sh/@upstash/ratelimit@2.0.5';
import { RateLimitCheckResult, RateLimiterService } from './types.ts';
import { CapabilityIssuerError } from './errors.ts';

const DEFAULT_REDIS_TIMEOUT_MS = 400; // Provisional staging timeout
export const ENV_NAMESPACE_REGEX = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export function resolveRateLimitConfig(): {
  url: string;
  token: string;
  pepper: string;
  namespace: string;
  timeoutMs: number;
} {
  const url = typeof Deno !== 'undefined' ? Deno.env?.get('UPSTASH_REDIS_REST_URL') : undefined;
  const token = typeof Deno !== 'undefined' ? Deno.env?.get('UPSTASH_REDIS_REST_TOKEN') : undefined;
  const pepper = typeof Deno !== 'undefined' ? Deno.env?.get('RATE_LIMIT_KEY_PEPPER') : undefined;
  const rawNamespace = typeof Deno !== 'undefined' ? Deno.env?.get('RATE_LIMIT_ENVIRONMENT_NAMESPACE') : undefined;
  const rawTimeout = typeof Deno !== 'undefined' ? Deno.env?.get('RATE_LIMIT_REDIS_TIMEOUT_MS') : undefined;

  if (!url || !token || !pepper || !rawNamespace) {
    throw new CapabilityIssuerError('rate_limit_unavailable', 'Rate limiting service configuration unavailable');
  }

  const namespace = rawNamespace.trim();
  if (!namespace || !ENV_NAMESPACE_REGEX.test(namespace)) {
    throw new CapabilityIssuerError('rate_limit_unavailable', 'Invalid rate limit environment namespace');
  }

  const timeoutMs = rawTimeout ? parseInt(rawTimeout, 10) || DEFAULT_REDIS_TIMEOUT_MS : DEFAULT_REDIS_TIMEOUT_MS;

  return {
    url: url.trim(),
    token: token.trim(),
    pepper: pepper.trim(),
    namespace,
    timeoutMs,
  };
}

/**
 * Derives an opaque Redis key using HMAC-SHA256 to prevent exposing raw UUIDs or IPs.
 * Output format: competition:<environment>:cap:<dimension>:<hex_hash>
 */
export async function deriveOpaqueKey(
  dimension: 'participant' | 'user' | 'session' | 'ip',
  rawIdentifier: string,
  pepper: string,
  namespace: string
): Promise<string> {
  const cleanNamespace = typeof namespace === 'string' ? namespace.trim() : '';
  if (!cleanNamespace || !ENV_NAMESPACE_REGEX.test(cleanNamespace)) {
    throw new CapabilityIssuerError('rate_limit_unavailable', 'Invalid rate limit environment namespace');
  }

  const encoder = new TextEncoder();
  const keyData = encoder.encode(pepper);
  const msgData = encoder.encode(`${dimension}:${rawIdentifier}`);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
  const hashArray = Array.from(new Uint8Array(signatureBuffer));
  const hexHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  return `competition:${cleanNamespace}:cap:${dimension}:${hexHash}`;
}

export class UpstashRateLimiterService implements RateLimiterService {
  private readonly url: string;
  private readonly token: string;
  private readonly pepper: string;
  private readonly namespace: string;
  private readonly timeoutMs: number;

  constructor(
    url: string,
    token: string,
    pepper: string,
    namespace: string,
    timeoutMs: number = DEFAULT_REDIS_TIMEOUT_MS
  ) {
    const cleanNamespace = typeof namespace === 'string' ? namespace.trim() : '';
    if (!cleanNamespace || !ENV_NAMESPACE_REGEX.test(cleanNamespace)) {
      throw new CapabilityIssuerError('rate_limit_unavailable', 'Invalid rate limit environment namespace');
    }

    this.url = url;
    this.token = token;
    this.pepper = pepper;
    this.namespace = cleanNamespace;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Creates a fresh, request-scoped Ratelimit instance with an independent AbortSignal.
   * This guarantees that:
   * 1. @upstash/redis 1.34.3 receives an AbortSignal instance (not a function), avoiding TypeError.
   * 2. An expired/aborted signal is never reused on future limiter invocations.
   */
  private createScopedLimiter(type: 'participant' | 'user' | 'session'): Ratelimit {
    const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(this.timeoutMs)
      : undefined;

    const redis = new Redis({
      url: this.url,
      token: this.token,
      signal,
      retry: {
        retries: 0,
      },
      enableTelemetry: false,
    });

    let algorithm;
    if (type === 'session') {
      // Session Aggregate Limiter: Sliding Window (Provisional Staging default: 50 reqs / 60s)
      algorithm = Ratelimit.slidingWindow(50, '60 s');
    } else {
      // Participant & Auth User Limiter: Token Bucket (Capacity 4, 1 refill / 30s)
      algorithm = Ratelimit.tokenBucket(1, '30 s', 4);
    }

    return new Ratelimit({
      redis,
      limiter: algorithm,
      analytics: false,
      ephemeralCache: false,
    });
  }

  private calculateRetryAfterSeconds(resetTimestampMs?: number): number {
    if (!resetTimestampMs || typeof resetTimestampMs !== 'number') {
      return 1;
    }
    const diffMs = resetTimestampMs - Date.now();
    return Math.max(1, Math.ceil(diffMs / 1000));
  }

  private classifyError(err: any): string {
    const name = err?.name;
    if (name === 'TimeoutError') return 'TimeoutError';
    if (name === 'AbortError') return 'AbortError';
    if (name === 'TypeError') return 'TypeError';
    if (name === 'UpstashError') return 'UpstashError';
    if (name === 'UrlError') return 'UrlError';
    if (err instanceof CapabilityIssuerError) return err.errorCode;
    return 'UnknownError';
  }

  async checkParticipant(sessionId: string, participantId: string, requestId?: string): Promise<RateLimitCheckResult> {
    const opaqueKey = await deriveOpaqueKey('participant', `${sessionId}:${participantId}`, this.pepper, this.namespace);
    const startTime = Date.now();
    try {
      const limiter = this.createScopedLimiter('participant');
      const res = await limiter.limit(opaqueKey);
      const redisElapsedMs = Date.now() - startTime;
      if (!res.success) {
        return {
          allowed: false,
          retryAfter: this.calculateRetryAfterSeconds(res.reset),
          remaining: res.remaining,
          reset: res.reset,
        };
      }
      return { allowed: true, remaining: res.remaining, reset: res.reset };
    } catch (err: any) {
      const redisElapsedMs = Date.now() - startTime;
      const errorClass = this.classifyError(err);
      console.error(JSON.stringify({
        request_id: requestId || 'unknown',
        rate_limit_stage: 'participant',
        error_class: errorClass,
        redis_elapsed_ms: redisElapsedMs,
      }));
      throw new CapabilityIssuerError('rate_limit_unavailable', 'Rate limiting service is temporarily unavailable');
    }
  }

  async checkAuthUser(userId: string, requestId?: string): Promise<RateLimitCheckResult> {
    const opaqueKey = await deriveOpaqueKey('user', userId, this.pepper, this.namespace);
    const startTime = Date.now();
    try {
      const limiter = this.createScopedLimiter('user');
      const res = await limiter.limit(opaqueKey);
      const redisElapsedMs = Date.now() - startTime;
      if (!res.success) {
        return {
          allowed: false,
          retryAfter: this.calculateRetryAfterSeconds(res.reset),
          remaining: res.remaining,
          reset: res.reset,
        };
      }
      return { allowed: true, remaining: res.remaining, reset: res.reset };
    } catch (err: any) {
      const redisElapsedMs = Date.now() - startTime;
      const errorClass = this.classifyError(err);
      console.error(JSON.stringify({
        request_id: requestId || 'unknown',
        rate_limit_stage: 'user',
        error_class: errorClass,
        redis_elapsed_ms: redisElapsedMs,
      }));
      throw new CapabilityIssuerError('rate_limit_unavailable', 'Rate limiting service is temporarily unavailable');
    }
  }

  async checkSession(sessionId: string, requestId?: string): Promise<RateLimitCheckResult> {
    const opaqueKey = await deriveOpaqueKey('session', sessionId, this.pepper, this.namespace);
    const startTime = Date.now();
    try {
      const limiter = this.createScopedLimiter('session');
      const res = await limiter.limit(opaqueKey);
      const redisElapsedMs = Date.now() - startTime;
      if (!res.success) {
        return {
          allowed: false,
          retryAfter: this.calculateRetryAfterSeconds(res.reset),
          remaining: res.remaining,
          reset: res.reset,
        };
      }
      return { allowed: true, remaining: res.remaining, reset: res.reset };
    } catch (err: any) {
      const redisElapsedMs = Date.now() - startTime;
      const errorClass = this.classifyError(err);
      console.error(JSON.stringify({
        request_id: requestId || 'unknown',
        rate_limit_stage: 'session',
        error_class: errorClass,
        redis_elapsed_ms: redisElapsedMs,
      }));
      throw new CapabilityIssuerError('rate_limit_unavailable', 'Rate limiting service is temporarily unavailable');
    }
  }
}

let globalLimiterService: RateLimiterService | null = null;

export function getRateLimiterService(): RateLimiterService {
  if (!globalLimiterService) {
    const config = resolveRateLimitConfig();
    if (!config) {
      throw new CapabilityIssuerError('rate_limit_unavailable', 'Rate limiting service configuration unavailable');
    }
    globalLimiterService = new UpstashRateLimiterService(
      config.url,
      config.token,
      config.pepper,
      config.namespace,
      config.timeoutMs
    );
  }
  return globalLimiterService;
}
