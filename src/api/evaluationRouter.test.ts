import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { Role } from '../domain/Role.js';

vi.mock('../config/container.js', () => ({
    evaluationController: {
        getByRunId: vi.fn((req, res) => res.status(200).json({ runId: req.params.runId })),
        listByTenant: vi.fn((req, res) => res.status(200).json({ tenantId: req.query.tenantId, items: [] })),
        getVersionStats: vi.fn((req, res) => res.status(200).json({ version: req.params.version })),
        compareVersions: vi.fn((req, res) => res.status(200).json({ compared: true })),
        detectRegression: vi.fn((req, res) => res.status(200).json({ hasRegression: false })),
        getTenantSummary: vi.fn((req, res) => res.status(200).json({ tenantId: req.params.tenantId })),
    },
}));

vi.mock('../usecases/LoginUserUseCase.js', () => ({
    LoginUserUseCase: {
        verify: vi.fn(),
    },
}));

import evaluationRouter from './evaluationRouter.js';
import { LoginUserUseCase } from '../usecases/LoginUserUseCase.js';
import { evaluationController } from '../config/container.js';

describe('evaluationRouter (Integration with authMiddleware & requireRole)', () => {
    let app: express.Express;
    let server: Server;
    let baseUrl: string;

    beforeEach(async () => {
        vi.clearAllMocks();

        app = express();
        app.use(express.json());
        app.use('/api', evaluationRouter);

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

    describe('Autenticação e Controle de Acesso RBAC', () => {
        it('deve retornar 401 se Authorization header estiver ausente', async () => {
            const res = await fetch(`${baseUrl}/evaluations/run-123`);

            expect(res.status).toBe(401);
            const body = await res.json();
            expect(body.error).toContain('Unauthorized');
            expect(evaluationController.getByRunId).not.toHaveBeenCalled();
        });

        it('deve retornar 403 se o usuário autenticado não possuir papel de ADMIN', async () => {
            vi.mocked(LoginUserUseCase.verify).mockResolvedValueOnce({
                sub: 'user-op',
                email: 'operator@acme.com',
                role: Role.OPERATOR,
                workspaceIds: ['ws-1'],
            });

            const res = await fetch(`${baseUrl}/evaluations/run-123`, {
                headers: { Authorization: 'Bearer valid-operator-token' },
            });

            expect(res.status).toBe(403);
            const body = await res.json();
            expect(body.error).toContain('Forbidden');
            expect(evaluationController.getByRunId).not.toHaveBeenCalled();
        });

        it('deve permitir acesso e retornar 200 para usuário ADMIN', async () => {
            vi.mocked(LoginUserUseCase.verify).mockResolvedValueOnce({
                sub: 'user-admin',
                email: 'admin@acme.com',
                role: Role.ADMIN,
                workspaceIds: ['ws-1'],
            });

            const res = await fetch(`${baseUrl}/evaluations/run-123`, {
                headers: { Authorization: 'Bearer valid-admin-token' },
            });

            expect(res.status).toBe(200);
            expect(evaluationController.getByRunId).toHaveBeenCalled();
        });
    });

    describe('Rotas de Avaliação e Agregação', () => {
        beforeEach(() => {
            vi.mocked(LoginUserUseCase.verify).mockResolvedValue({
                sub: 'user-admin',
                email: 'admin@acme.com',
                role: Role.ADMIN,
                workspaceIds: ['ws-1'],
            });
        });

        it('GET /api/evaluations/stats/:version deve chamar getVersionStats', async () => {
            const res = await fetch(`${baseUrl}/evaluations/stats/1.2.0`, {
                headers: { Authorization: 'Bearer valid-admin-token' },
            });

            expect(res.status).toBe(200);
            expect(evaluationController.getVersionStats).toHaveBeenCalled();
        });

        it('GET /api/evaluations/compare deve chamar compareVersions', async () => {
            const res = await fetch(`${baseUrl}/evaluations/compare?versionA=1.0.0&versionB=1.1.0`, {
                headers: { Authorization: 'Bearer valid-admin-token' },
            });

            expect(res.status).toBe(200);
            expect(evaluationController.compareVersions).toHaveBeenCalled();
        });

        it('GET /api/evaluations/regression deve chamar detectRegression', async () => {
            const res = await fetch(`${baseUrl}/evaluations/regression?currentVersion=2.0.0&previousVersion=1.0.0`, {
                headers: { Authorization: 'Bearer valid-admin-token' },
            });

            expect(res.status).toBe(200);
            expect(evaluationController.detectRegression).toHaveBeenCalled();
        });

        it('GET /api/evaluations/summary/:tenantId deve chamar getTenantSummary', async () => {
            const res = await fetch(`${baseUrl}/evaluations/summary/tenant-xyz`, {
                headers: { Authorization: 'Bearer valid-admin-token' },
            });

            expect(res.status).toBe(200);
            expect(evaluationController.getTenantSummary).toHaveBeenCalled();
        });

        it('GET /api/evaluations deve chamar listByTenant', async () => {
            const res = await fetch(`${baseUrl}/evaluations?tenantId=tenant-xyz`, {
                headers: { Authorization: 'Bearer valid-admin-token' },
            });

            expect(res.status).toBe(200);
            expect(evaluationController.listByTenant).toHaveBeenCalled();
        });
    });
});
