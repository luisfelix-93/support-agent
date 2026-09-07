import { describe, it, expect, vi } from 'vitest';
import { HealthChecker } from './HealthChecker.js';
import type { Redis } from 'ioredis';

describe('HealthChecker', () => {
    it('deve retornar status ready quando MongoDB e Redis estão saudáveis', async () => {
        const mockRedis = {
            ping: vi.fn().mockResolvedValue('PONG'),
        } as unknown as Redis;

        const mockMongoPing = vi.fn().mockResolvedValue(true);

        const healthChecker = new HealthChecker({
            redisClient: mockRedis,
            mongoPingFn: mockMongoPing,
        });

        const result = await healthChecker.checkReadiness();

        expect(result.status).toBe('ready');
        expect(result.checks.mongodb).toBe('ok');
        expect(result.checks.redis).toBe('ok');
        expect(mockMongoPing).toHaveBeenCalled();
        expect(mockRedis.ping).toHaveBeenCalled();
    });

    it('deve retornar status degraded quando MongoDB falhar', async () => {
        const mockRedis = {
            ping: vi.fn().mockResolvedValue('PONG'),
        } as unknown as Redis;

        const mockMongoPing = vi.fn().mockResolvedValue(false);

        const healthChecker = new HealthChecker({
            redisClient: mockRedis,
            mongoPingFn: mockMongoPing,
        });

        const result = await healthChecker.checkReadiness();

        expect(result.status).toBe('degraded');
        expect(result.checks.mongodb).toBe('fail');
        expect(result.checks.redis).toBe('ok');
    });

    it('deve retornar status degraded quando Redis falhar', async () => {
        const mockRedis = {
            ping: vi.fn().mockResolvedValue('NO_PONG'),
        } as unknown as Redis;

        const mockMongoPing = vi.fn().mockResolvedValue(true);

        const healthChecker = new HealthChecker({
            redisClient: mockRedis,
            mongoPingFn: mockMongoPing,
        });

        const result = await healthChecker.checkReadiness();

        expect(result.status).toBe('degraded');
        expect(result.checks.mongodb).toBe('ok');
        expect(result.checks.redis).toBe('fail');
    });

    it('deve tratar exceção lançada pelo MongoDB como fail e status degraded', async () => {
        const mockRedis = {
            ping: vi.fn().mockResolvedValue('PONG'),
        } as unknown as Redis;

        const mockMongoPing = vi.fn().mockRejectedValue(new Error('Mongo connection timeout'));

        const healthChecker = new HealthChecker({
            redisClient: mockRedis,
            mongoPingFn: mockMongoPing,
        });

        const result = await healthChecker.checkReadiness();

        expect(result.status).toBe('degraded');
        expect(result.checks.mongodb).toBe('fail');
        expect(result.checks.redis).toBe('ok');
    });

    it('deve tratar exceção lançada pelo Redis como fail e status degraded', async () => {
        const mockRedis = {
            ping: vi.fn().mockRejectedValue(new Error('Redis connection refused')),
        } as unknown as Redis;

        const mockMongoPing = vi.fn().mockResolvedValue(true);

        const healthChecker = new HealthChecker({
            redisClient: mockRedis,
            mongoPingFn: mockMongoPing,
        });

        const result = await healthChecker.checkReadiness();

        expect(result.status).toBe('degraded');
        expect(result.checks.mongodb).toBe('ok');
        expect(result.checks.redis).toBe('fail');
    });

    it('deve retornar fail para Redis se redisClient for nulo', async () => {
        const mockMongoPing = vi.fn().mockResolvedValue(true);

        const healthChecker = new HealthChecker({
            redisClient: null,
            mongoPingFn: mockMongoPing,
        });

        const result = await healthChecker.checkReadiness();

        expect(result.status).toBe('degraded');
        expect(result.checks.mongodb).toBe('ok');
        expect(result.checks.redis).toBe('fail');
    });
});
