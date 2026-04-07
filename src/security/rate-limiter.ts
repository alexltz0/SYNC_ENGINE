import { createChildLogger } from '../utils/logger';
import { config } from '../config';

const log = createChildLogger('RateLimiter');

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterMs?: number;
}

export class RateLimiter {
  private limits = new Map<string, RateLimitEntry>();
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private blocked: number = 0;
  private allowed: number = 0;

  constructor(windowMs?: number, maxRequests?: number) {
    this.windowMs = windowMs || config.security.rateLimit.window;
    this.maxRequests = maxRequests || config.security.rateLimit.maxRequests;
  }

  start(): void {
    this.cleanupInterval = setInterval(() => this.cleanup(), this.windowMs);
  }

  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.limits.clear();
  }

  check(key: string): RateLimitResult {
    const now = Date.now();
    let entry = this.limits.get(key);

    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.limits.set(key, entry);
    }

    entry.count++;

    if (entry.count > this.maxRequests) {
      this.blocked++;
      return {
        allowed: false,
        remaining: 0,
        resetAt: entry.resetAt,
        retryAfterMs: entry.resetAt - now,
      };
    }

    this.allowed++;
    return {
      allowed: true,
      remaining: this.maxRequests - entry.count,
      resetAt: entry.resetAt,
    };
  }

  reset(key: string): void {
    this.limits.delete(key);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.limits) {
      if (now >= entry.resetAt) {
        this.limits.delete(key);
      }
    }
  }

  getStats(): { trackedKeys: number; blocked: number; allowed: number } {
    return { trackedKeys: this.limits.size, blocked: this.blocked, allowed: this.allowed };
  }
}

export class TieredRateLimiter {
  private tiers = new Map<string, RateLimiter>();

  addTier(name: string, windowMs: number, maxRequests: number): void {
    const limiter = new RateLimiter(windowMs, maxRequests);
    limiter.start();
    this.tiers.set(name, limiter);
  }

  check(key: string): RateLimitResult {
    for (const [tierName, limiter] of this.tiers) {
      const result = limiter.check(key);
      if (!result.allowed) {
        log.debug('Rate limited', { key, tier: tierName });
        return result;
      }
    }
    return { allowed: true, remaining: -1, resetAt: 0 };
  }

  stop(): void {
    for (const limiter of this.tiers.values()) {
      limiter.stop();
    }
    this.tiers.clear();
  }
}
