/// <reference path="../types/express.d.ts" />
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requireRole } from './requireRole.js';
import { Role } from '../../domain/Role.js';

function mockReq(role?: Role): Partial<Request> {
    return {
        user: role !== undefined ? { sub: 'user-1', email: 'a@b.com', role, workspaceIds: [] } : undefined,
    };
}

function mockRes(): Partial<Response> {
    const res: Partial<Response> = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
}

describe('requireRole', () => {
    it('deve chamar next() se o user tem a role permitida', () => {
        const middleware = requireRole(Role.ADMIN);
        const req = mockReq(Role.ADMIN);
        const res = mockRes();
        const next = vi.fn();

        middleware(req as Request, res as Response, next as NextFunction);

        expect(next).toHaveBeenCalledOnce();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('deve aceitar qualquer uma das roles permitidas', () => {
        const middleware = requireRole(Role.ADMIN, Role.OPERATOR);
        const req = mockReq(Role.OPERATOR);
        const res = mockRes();
        const next = vi.fn();

        middleware(req as Request, res as Response, next as NextFunction);

        expect(next).toHaveBeenCalledOnce();
    });

    it('deve retornar 403 se o user não tem a role permitida', () => {
        const middleware = requireRole(Role.ADMIN);
        const req = mockReq(Role.OPERATOR);
        const res = mockRes();
        const next = vi.fn();

        middleware(req as Request, res as Response, next as NextFunction);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden: insufficient permissions.' });
    });

    it('deve retornar 403 se req.user é undefined', () => {
        const middleware = requireRole(Role.ADMIN);
        const req = { user: undefined } as Partial<Request>;
        const res = mockRes();
        const next = vi.fn();

        middleware(req as Request, res as Response, next as NextFunction);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });

    it('deve retornar 403 para VIEWER tentando acessar rota de ADMIN', () => {
        const middleware = requireRole(Role.ADMIN);
        const req = mockReq(Role.VIEWER);
        const res = mockRes();
        const next = vi.fn();

        middleware(req as Request, res as Response, next as NextFunction);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });
});
