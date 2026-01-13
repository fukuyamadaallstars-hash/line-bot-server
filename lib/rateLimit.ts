/**
 * Simple in-memory rate limiter
 * For production, consider using Redis or Upstash for distributed rate limiting
 */

interface RateLimitEntry {
    count: number;
    resetTime: number;
}

// In-memory store (per serverless instance)
const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up old entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
        if (entry.resetTime < now) {
            rateLimitStore.delete(key);
        }
    }
}, 5 * 60 * 1000);

export interface RateLimitConfig {
    windowMs: number;      // Time window in milliseconds
    maxRequests: number;   // Max requests per window
}

export interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    resetTime: number;
}

/**
 * Check rate limit for a given key
 * @param key - Unique identifier (e.g., userId, IP address)
 * @param config - Rate limit configuration
 * @returns Rate limit result
 */
export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
    const now = Date.now();
    const entry = rateLimitStore.get(key);

    // If no entry or window expired, create new entry
    if (!entry || entry.resetTime < now) {
        const newEntry: RateLimitEntry = {
            count: 1,
            resetTime: now + config.windowMs
        };
        rateLimitStore.set(key, newEntry);
        return {
            allowed: true,
            remaining: config.maxRequests - 1,
            resetTime: newEntry.resetTime
        };
    }

    // Window still active
    if (entry.count >= config.maxRequests) {
        return {
            allowed: false,
            remaining: 0,
            resetTime: entry.resetTime
        };
    }

    // Increment count
    entry.count++;
    return {
        allowed: true,
        remaining: config.maxRequests - entry.count,
        resetTime: entry.resetTime
    };
}

// Preset configurations
export const RATE_LIMITS = {
    // LINE Bot: 20 messages per user per minute
    LINE_BOT_USER: {
        windowMs: 60 * 1000,
        maxRequests: 20
    },
    // Portal Login: 5 attempts per IP per minute (prevent brute force)
    PORTAL_LOGIN: {
        windowMs: 60 * 1000,
        maxRequests: 5
    },
    // Admin API: 30 requests per minute
    ADMIN_API: {
        windowMs: 60 * 1000,
        maxRequests: 30
    }
};
