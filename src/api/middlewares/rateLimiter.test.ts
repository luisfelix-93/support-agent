import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { apiRateLimiter, authRateLimiter } from './rateLimiter.js';

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

    it('deve permitir chamadas na apiRateLimiter e chamar next()', async () => {
        const testReq = {
            ip: '127.0.0.1',
            path: '/api/test',
            headers: {},
        } as unknown as Request;
        await apiRateLimiter(testReq, res as Response, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('deve pular rate limiting na rota de healthcheck', async () => {
        const testReq = {
            ip: '127.0.0.1',
            path: '/api/health',
            headers: {},
        } as unknown as Request;
        await apiRateLimiter(testReq, res as Response, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('deve permitir chamadas na authRateLimiter e chamar next()', async () => {
        const testReq = {
            ip: '127.0.0.1',
            path: '/api/auth/login',
            headers: {},
        } as unknown as Request;
        await authRateLimiter(testReq, res as Response, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });
});
