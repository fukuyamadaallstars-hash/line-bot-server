import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkRateLimit, RATE_LIMITS } from './rateLimit';

describe('Rate Limiter', () => {
    beforeEach(() => {
        // Reset any internal state if needed
        vi.useFakeTimers();
    });

    describe('checkRateLimit', () => {
        it('should allow requests within the limit', () => {
            const key = 'test-user-1';
            const config = { windowMs: 60000, maxRequests: 5 };

            const result1 = checkRateLimit(key, config);
            expect(result1.allowed).toBe(true);
            expect(result1.remaining).toBe(4);

            const result2 = checkRateLimit(key, config);
            expect(result2.allowed).toBe(true);
            expect(result2.remaining).toBe(3);
        });

        it('should block requests over the limit', () => {
            const key = 'test-user-2';
            const config = { windowMs: 60000, maxRequests: 3 };

            // Use up all requests
            checkRateLimit(key, config);
            checkRateLimit(key, config);
            checkRateLimit(key, config);

            // Fourth request should be blocked
            const result = checkRateLimit(key, config);
            expect(result.allowed).toBe(false);
            expect(result.remaining).toBe(0);
        });

        it('should reset after window expires', () => {
            const key = 'test-user-3';
            const config = { windowMs: 60000, maxRequests: 2 };

            // Use up all requests
            checkRateLimit(key, config);
            checkRateLimit(key, config);

            // Should be blocked
            let result = checkRateLimit(key, config);
            expect(result.allowed).toBe(false);

            // Advance time past the window
            vi.advanceTimersByTime(61000);

            // Should be allowed again
            result = checkRateLimit(key, config);
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(1);
        });

        it('should track different keys separately', () => {
            const config = { windowMs: 60000, maxRequests: 2 };

            // User A uses both requests
            checkRateLimit('user-a', config);
            checkRateLimit('user-a', config);
            expect(checkRateLimit('user-a', config).allowed).toBe(false);

            // User B should still have full quota
            expect(checkRateLimit('user-b', config).allowed).toBe(true);
            expect(checkRateLimit('user-b', config).allowed).toBe(true);
            expect(checkRateLimit('user-b', config).allowed).toBe(false);
        });
    });

    describe('RATE_LIMITS presets', () => {
        it('should have proper LINE_BOT_USER config', () => {
            expect(RATE_LIMITS.LINE_BOT_USER.windowMs).toBe(60000);
            expect(RATE_LIMITS.LINE_BOT_USER.maxRequests).toBe(20);
        });

        it('should have proper PORTAL_LOGIN config', () => {
            expect(RATE_LIMITS.PORTAL_LOGIN.windowMs).toBe(60000);
            expect(RATE_LIMITS.PORTAL_LOGIN.maxRequests).toBe(5);
        });

        it('should have proper ADMIN_API config', () => {
            expect(RATE_LIMITS.ADMIN_API.windowMs).toBe(60000);
            expect(RATE_LIMITS.ADMIN_API.maxRequests).toBe(30);
        });
    });
});
