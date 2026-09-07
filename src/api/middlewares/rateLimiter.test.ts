/// <reference path="../types/express.d.ts" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { apiRateLimiter, authRateLimiter, tenantRateLimiter } from './rateLimiter.js';
import { Role } from '../../domain/Role.js';

describe('Rate Limiter Middlewares', () => {
    let res: Partial<Response>;
    let next: any;

    beforeEach(() => {
        res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
            setHeader: vi.fn(),
        };
        next = vi.fn();
    });

    const createMockReq = (overrides: Partial<Request> = {}): Request => ({
        ip: '127.0.0.1',
        path: '/api/test',
        headers: {},
        app: { get: vi.fn().mockReturnValue(1) } as any,
        socket: { remoteAddress: '127.0.0.1' } as any,
        ...overrides,
    } as unknown as Request);

    it('deve permitir chamadas na apiRateLimiter e chamar next()', async () => {
        const testReq = createMockReq({ path: '/api/test' });
        await apiRateLimiter(testReq, res as Response, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('deve pular rate limiting na rota de healthcheck e readiness', async () => {
        const healthReq = createMockReq({ path: '/api/health' });
        await apiRateLimiter(healthReq, res as Response, next);
        expect(next).toHaveBeenCalledTimes(1);

        const readyReq = createMockReq({ path: '/api/health/ready' });
        await apiRateLimiter(readyReq, res as Response, next);
        expect(next).toHaveBeenCalledTimes(2);

        expect(res.status).not.toHaveBeenCalled();
    });

    it('deve permitir chamadas na authRateLimiter e chamar next()', async () => {
        const testReq = createMockReq({ path: '/api/auth/login' });
        await authRateLimiter(testReq, res as Response, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('deve permitir chamadas no tenantRateLimiter com usuário autenticado e workspaceId', async () => {
        const testReq = createMockReq({
            path: '/api/chat-configs/ws-123',
            user: {
                sub: 'user-1',
                email: 'test@example.com',
                role: Role.OPERATOR,
                workspaceIds: ['ws-123'],
            },
        });

        await tenantRateLimiter(testReq, res as Response, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('deve permitir chamadas no tenantRateLimiter com fallback para IP quando não autenticado', async () => {
        const testReq = createMockReq({
            path: '/api/chat-configs/ws-123',
            user: undefined,
        });

        await tenantRateLimiter(testReq, res as Response, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('deve pular checagem do tenantRateLimiter nas rotas de health', async () => {
        const testReq = createMockReq({
            path: '/api/health/ready',
        });

        await tenantRateLimiter(testReq, res as Response, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });
});

