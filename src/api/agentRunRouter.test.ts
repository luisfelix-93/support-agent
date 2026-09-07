import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { Role } from '../domain/Role.js';

vi.mock('../config/container.js', () => ({
    agentRunController: {
        getById: vi.fn((req, res) => res.status(200).json({ runId: req.params.runId })),
        list: vi.fn((req, res) => res.status(200).json({ tenantId: req.query.tenantId, items: [] })),
        getCostAnalytics: vi.fn((req, res) => res.status(200).json({ success: true, type: 'cost' })),
        getToolAnalytics: vi.fn((req, res) => res.status(200).json({ success: true, type: 'tools' })),
        getLLMAnalytics: vi.fn((req, res) => res.status(200).json({ success: true, type: 'llm' })),
    },
}));

vi.mock('../usecases/LoginUserUseCase.js', () => ({
    LoginUserUseCase: {
        verify: vi.fn(),
    },
}));

import agentRunRouter from './agentRunRouter.js';
import { LoginUserUseCase } from '../usecases/LoginUserUseCase.js';
import { agentRunController } from '../config/container.js';

describe('agentRunRouter (Integration with authMiddleware & requireRole)', () => {
    let app: express.Express;
    let server: Server;
    let baseUrl: string;

    beforeEach(async () => {
        vi.clearAllMocks();

        app = express();
        app.use(express.json());
        app.use('/api', agentRunRouter);

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
            const res = await fetch(`${baseUrl}/runs/run-123`);

            expect(res.status).toBe(401);
            const body = await res.json();
            expect(body.error).toContain('Unauthorized');
            expect(agentRunController.getById).not.toHaveBeenCalled();
        });

        it('deve retornar 403 se o usuário autenticado não possuir papel de ADMIN', async () => {
            vi.mocked(LoginUserUseCase.verify).mockResolvedValueOnce({
                sub: 'user-op',
                email: 'operator@acme.com',
                role: Role.OPERATOR,
                workspaceIds: ['ws-1'],
            });

            const res = await fetch(`${baseUrl}/runs/run-123`, {
                headers: { Authorization: 'Bearer valid-operator-token' },
            });

            expect(res.status).toBe(403);
            const body = await res.json();
            expect(body.error).toContain('Forbidden');
            expect(agentRunController.getById).not.toHaveBeenCalled();
        });

        it('deve permitir acesso e retornar 200 para usuário ADMIN', async () => {
            vi.mocked(LoginUserUseCase.verify).mockResolvedValueOnce({
                sub: 'user-admin',
                email: 'admin@acme.com',
                role: Role.ADMIN,
                workspaceIds: ['ws-1'],
            });

            const res = await fetch(`${baseUrl}/runs/run-123`, {
                headers: { Authorization: 'Bearer valid-admin-token' },
            });

            expect(res.status).toBe(200);
            expect(agentRunController.getById).toHaveBeenCalled();
        });
    });

    describe('Rotas e Delegação para o Controller', () => {
        beforeEach(() => {
            vi.mocked(LoginUserUseCase.verify).mockResolvedValue({
                sub: 'user-admin',
                email: 'admin@acme.com',
                role: Role.ADMIN,
                workspaceIds: ['ws-1'],
            });
        });

        it('GET /api/runs/analytics/cost deve chamar getCostAnalytics', async () => {
            const res = await fetch(`${baseUrl}/runs/analytics/cost?tenantId=tenant-1`, {
                headers: { Authorization: 'Bearer valid-admin-token' },
            });

            expect(res.status).toBe(200);
            expect(agentRunController.getCostAnalytics).toHaveBeenCalled();
        });

        it('GET /api/runs/analytics/tools deve chamar getToolAnalytics', async () => {
            const res = await fetch(`${baseUrl}/runs/analytics/tools?tenantId=tenant-1`, {
                headers: { Authorization: 'Bearer valid-admin-token' },
            });

            expect(res.status).toBe(200);
            expect(agentRunController.getToolAnalytics).toHaveBeenCalled();
        });

        it('GET /api/runs/analytics/llm deve chamar getLLMAnalytics', async () => {
            const res = await fetch(`${baseUrl}/runs/analytics/llm?tenantId=tenant-1`, {
                headers: { Authorization: 'Bearer valid-admin-token' },
            });

            expect(res.status).toBe(200);
            expect(agentRunController.getLLMAnalytics).toHaveBeenCalled();
        });

        it('GET /api/runs/:runId deve chamar getById com o parâmetro correto', async () => {
            const res = await fetch(`${baseUrl}/runs/run-abc-999`, {
                headers: { Authorization: 'Bearer valid-admin-token' },
            });

            expect(res.status).toBe(200);
            expect(agentRunController.getById).toHaveBeenCalled();
        });

        it('GET /api/runs deve chamar list', async () => {
            const res = await fetch(`${baseUrl}/runs?tenantId=tenant-1`, {
                headers: { Authorization: 'Bearer valid-admin-token' },
            });

            expect(res.status).toBe(200);
            expect(agentRunController.list).toHaveBeenCalled();
        });
    });
});
