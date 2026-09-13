import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { Role } from '../domain/Role.js';

vi.mock('../config/container.js', () => ({
    memoryController: {
        list: vi.fn((_req, res) => res.status(200).json({ success: true, list: [] })),
        search: vi.fn((_req, res) => res.status(200).json({ success: true, search: [] })),
        getCandidates: vi.fn((_req, res) => res.status(200).json({ success: true, candidates: [] })),
        updateStatus: vi.fn((req, res) => res.status(200).json({ success: true, id: req.params.id, status: req.body.status })),
        update: vi.fn((req, res) => res.status(200).json({ success: true, id: req.params.id })),
        delete: vi.fn((req, res) => res.status(200).json({ success: true, id: req.params.id })),
    },
}));

vi.mock('../usecases/LoginUserUseCase.js', () => ({
    LoginUserUseCase: {
        verify: vi.fn(),
    },
}));

import memoryRouter from './memoryRouter.js';
import { LoginUserUseCase } from '../usecases/LoginUserUseCase.js';
import { memoryController } from '../config/container.js';

describe('memoryRouter (Auth & RBAC Integration)', () => {
    let app: express.Express;
    let server: Server;
    let baseUrl: string;

    beforeEach(async () => {
        vi.clearAllMocks();

        app = express();
        app.use(express.json());
        app.use('/api', memoryRouter);

        await new Promise<void>((resolve) => {
            server = app.listen(0, () => {
                const addr = server.address();
                if (addr && typeof addr === 'object') {
                    baseUrl = `http://127.0.0.1:${addr.port}/api`;
                }
                resolve();
            });
        });
    });

    afterEach(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('deve retornar 401 se Authorization header estiver ausente', async () => {
        const res = await fetch(`${baseUrl}/memories`);
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.error).toContain('missing or invalid Authorization header');
    });

    it('GET /api/memories deve permitir acesso a VIEWER', async () => {
        vi.mocked(LoginUserUseCase.verify).mockResolvedValue({
            userId: 'user-v',
            email: 'viewer@example.com',
            role: Role.VIEWER,
            tenantId: 'tenant-123',
        });

        const res = await fetch(`${baseUrl}/memories?tenantId=tenant-123`, {
            headers: { Authorization: 'Bearer token-viewer' },
        });

        expect(res.status).toBe(200);
        expect(memoryController.list).toHaveBeenCalled();
    });

    it('POST /api/memories/search deve permitir acesso a VIEWER, OPERATOR e ADMIN', async () => {
        vi.mocked(LoginUserUseCase.verify).mockResolvedValue({
            userId: 'user-o',
            email: 'op@example.com',
            role: Role.OPERATOR,
            tenantId: 'tenant-123',
        });

        const res = await fetch(`${baseUrl}/memories/search`, {
            method: 'POST',
            headers: {
                Authorization: 'Bearer token-op',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                tenantId: 'tenant-123',
                workspaceId: 'ws-1',
                query: 'timeout',
            }),
        });

        expect(res.status).toBe(200);
        expect(memoryController.search).toHaveBeenCalled();
    });

    it('GET /api/memories/candidates deve bloquear VIEWER com 403', async () => {
        vi.mocked(LoginUserUseCase.verify).mockResolvedValue({
            userId: 'user-v',
            email: 'viewer@example.com',
            role: Role.VIEWER,
            tenantId: 'tenant-123',
        });

        const res = await fetch(`${baseUrl}/memories/candidates?tenantId=tenant-123`, {
            headers: { Authorization: 'Bearer token-viewer' },
        });

        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.error).toContain('insufficient permissions');
    });

    it('GET /api/memories/candidates deve permitir acesso a OPERATOR', async () => {
        vi.mocked(LoginUserUseCase.verify).mockResolvedValue({
            userId: 'user-o',
            email: 'operator@example.com',
            role: Role.OPERATOR,
            tenantId: 'tenant-123',
        });

        const res = await fetch(`${baseUrl}/memories/candidates?tenantId=tenant-123`, {
            headers: { Authorization: 'Bearer token-op' },
        });

        expect(res.status).toBe(200);
        expect(memoryController.getCandidates).toHaveBeenCalled();
    });

    it('PATCH /api/memories/:id/status deve permitir acesso a OPERATOR e ADMIN', async () => {
        vi.mocked(LoginUserUseCase.verify).mockResolvedValue({
            userId: 'user-o',
            email: 'operator@example.com',
            role: Role.OPERATOR,
            tenantId: 'tenant-123',
        });

        const res = await fetch(`${baseUrl}/memories/mem-1/status`, {
            method: 'PATCH',
            headers: {
                Authorization: 'Bearer token-op',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ status: 'validated' }),
        });

        expect(res.status).toBe(200);
        expect(memoryController.updateStatus).toHaveBeenCalled();
    });

    it('DELETE /api/memories/:id deve bloquear OPERATOR com 403', async () => {
        vi.mocked(LoginUserUseCase.verify).mockResolvedValue({
            userId: 'user-o',
            email: 'operator@example.com',
            role: Role.OPERATOR,
            tenantId: 'tenant-123',
        });

        const res = await fetch(`${baseUrl}/memories/mem-1?tenantId=tenant-123`, {
            method: 'DELETE',
            headers: { Authorization: 'Bearer token-op' },
        });

        expect(res.status).toBe(403);
    });

    it('DELETE /api/memories/:id deve permitir acesso a ADMIN', async () => {
        vi.mocked(LoginUserUseCase.verify).mockResolvedValue({
            userId: 'user-admin',
            email: 'admin@example.com',
            role: Role.ADMIN,
            tenantId: 'tenant-123',
        });

        const res = await fetch(`${baseUrl}/memories/mem-1?tenantId=tenant-123`, {
            method: 'DELETE',
            headers: { Authorization: 'Bearer token-admin' },
        });

        expect(res.status).toBe(200);
        expect(memoryController.delete).toHaveBeenCalled();
    });
});
