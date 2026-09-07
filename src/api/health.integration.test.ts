import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Server } from 'http';

const { mockCheckReadiness } = vi.hoisted(() => ({
    mockCheckReadiness: vi.fn(),
}));

vi.mock('../config/container.js', () => ({
    healthChecker: {
        checkReadiness: mockCheckReadiness,
    },
    webhookController: { handle: vi.fn() },
    authController: { register: vi.fn(), login: vi.fn() },
    onboardingController: {
        registerTenant: vi.fn(),
        registerSpace: vi.fn(),
        associateTenant: vi.fn(),
    },
    slackWebhookController: { handleWebhook: vi.fn() },
    chatConfigController: {
        register: vi.fn(),
        getByWorkspaceId: vi.fn(),
    },
    queueWorker: { stop: vi.fn() },
    memoryPromotionWorker: { stop: vi.fn() },
    redisConnection: { quit: vi.fn() },
}));

import app from '../app.js';

describe('Health Endpoints Integration', () => {
    let server: Server;
    let baseUrl: string;

    beforeEach(async () => {
        vi.clearAllMocks();

        await new Promise<void>((resolve) => {
            server = app.listen(0, () => {
                const addr = server.address();
                if (addr && typeof addr === 'object') {
                    baseUrl = `http://127.0.0.1:${addr.port}/api/health`;
                }
                resolve();
            });
        });
    });

    afterEach(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('GET /api/health deve responder 200 com status ok (liveness probe)', async () => {
        const res = await fetch(`${baseUrl}`);
        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data.status).toBe('ok');
        expect(data.timestamp).toBeDefined();
    });

    it('GET /api/health/ready deve responder 200 quando dependências estiverem prontas', async () => {
        mockCheckReadiness.mockResolvedValueOnce({
            status: 'ready',
            checks: {
                mongodb: 'ok',
                redis: 'ok',
            },
        });

        const res = await fetch(`${baseUrl}/ready`);
        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data.status).toBe('ready');
        expect(data.checks.mongodb).toBe('ok');
        expect(data.checks.redis).toBe('ok');
        expect(data.timestamp).toBeDefined();
    });

    it('GET /api/health/ready deve responder 503 quando dependências estiverem degradadas', async () => {
        mockCheckReadiness.mockResolvedValueOnce({
            status: 'degraded',
            checks: {
                mongodb: 'fail',
                redis: 'ok',
            },
        });

        const res = await fetch(`${baseUrl}/ready`);
        expect(res.status).toBe(503);

        const data = await res.json();
        expect(data.status).toBe('degraded');
        expect(data.checks.mongodb).toBe('fail');
        expect(data.checks.redis).toBe('ok');
        expect(data.timestamp).toBeDefined();
    });
});
