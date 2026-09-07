/// <reference path="../types/express.d.ts" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { tenantGuard } from './tenantGuard.js';
import { Role } from '../../domain/Role.js';

function createMockReq(overrides: Partial<Request> = {}): Request {
    return {
        params: {},
        body: {},
        headers: {},
        ...overrides,
    } as unknown as Request;
}

function createMockRes() {
    const res: Partial<Response> = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

describe('tenantGuard', () => {
    const next: NextFunction = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('deve chamar next() quando o workspaceId presente em req.params pertencer ao usuário', () => {
        const req = createMockReq({
            params: { workspaceId: 'ws-123' },
            user: {
                sub: 'user-1',
                email: 'user@example.com',
                role: Role.OPERATOR,
                workspaceIds: ['ws-123', 'ws-456'],
            },
        });
        const res = createMockRes();

        const middleware = tenantGuard();
        middleware(req, res, next);

        expect(next).toHaveBeenCalledOnce();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('deve chamar next() quando o workspaceId presente em req.body pertencer ao usuário', () => {
        const req = createMockReq({
            body: { workspaceId: 'ws-456' },
            user: {
                sub: 'user-1',
                email: 'user@example.com',
                role: Role.OPERATOR,
                workspaceIds: ['ws-123', 'ws-456'],
            },
        });
        const res = createMockRes();

        const middleware = tenantGuard();
        middleware(req, res, next);

        expect(next).toHaveBeenCalledOnce();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('deve suportar paramName customizado', () => {
        const req = createMockReq({
            params: { customTenantId: 'ws-999' },
            user: {
                sub: 'user-1',
                email: 'user@example.com',
                role: Role.OPERATOR,
                workspaceIds: ['ws-999'],
            },
        });
        const res = createMockRes();

        const middleware = tenantGuard('customTenantId');
        middleware(req, res, next);

        expect(next).toHaveBeenCalledOnce();
    });

    it('deve retornar 401 quando req.user não estiver presente', () => {
        const req = createMockReq({
            params: { workspaceId: 'ws-123' },
        });
        const res = createMockRes();

        const middleware = tenantGuard();
        middleware(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: authentication required.' });
    });

    it('deve retornar 403 quando o workspaceId não for fornecido', () => {
        const req = createMockReq({
            user: {
                sub: 'user-1',
                email: 'user@example.com',
                role: Role.OPERATOR,
                workspaceIds: ['ws-123'],
            },
        });
        const res = createMockRes();

        const middleware = tenantGuard();
        middleware(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden: workspaceId is required.' });
    });

    it('deve retornar 403 quando o workspaceId não pertencer ao usuário (cross-tenant)', () => {
        const req = createMockReq({
            params: { workspaceId: 'ws-attacker' },
            user: {
                sub: 'user-1',
                email: 'user@example.com',
                role: Role.OPERATOR,
                workspaceIds: ['ws-123'],
            },
        });
        const res = createMockRes();

        const middleware = tenantGuard();
        middleware(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden: access to this workspace is denied.' });
    });
});
