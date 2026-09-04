import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { auditLogger } from './auditLogger.js';
import { Role } from '../../domain/Role.js';

vi.mock('../../config/logger.js', () => ({
    logger: {
        child: () => ({
            info: vi.fn(),
        }),
    },
}));

function mockReq(overrides: Partial<Request> = {}): Partial<Request> {
    return {
        user: { sub: 'user-1', email: 'admin@test.com', role: Role.ADMIN, workspaceIds: ['ws-1'] },
        method: 'POST',
        originalUrl: '/api/onboarding/tenants',
        ip: '127.0.0.1',
        ...overrides,
    };
}

function mockRes(): Partial<Response> & { _finishCallbacks: (() => void)[] } {
    const res: any = { _finishCallbacks: [] as (() => void)[] };
    res.statusCode = 201;
    res.on = vi.fn().mockImplementation((event: string, cb: () => void) => {
        if (event === 'finish') res._finishCallbacks.push(cb);
        return res;
    });
    return res;
}

describe('auditLogger', () => {
    it('deve registrar listener no evento finish e chamar next()', () => {
        const middleware = auditLogger('register-tenant');
        const req = mockReq();
        const res = mockRes();
        const next = vi.fn();

        middleware(req as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalledOnce();
        expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));
    });

    it('deve funcionar com usuário anônimo', () => {
        const middleware = auditLogger('register-user');
        const req = mockReq({ user: undefined });
        const res = mockRes();
        const next = vi.fn();

        middleware(req as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalledOnce();

        // Simula o finish
        for (const cb of res._finishCallbacks) cb();
    });

    it('deve executar o callback de finish sem erros', () => {
        const middleware = auditLogger('test-action');
        const req = mockReq();
        const res = mockRes();
        const next = vi.fn();

        middleware(req as Request, res as unknown as Response, next as NextFunction);

        // Simula o finish do response
        expect(() => {
            for (const cb of res._finishCallbacks) cb();
        }).not.toThrow();
    });
});
