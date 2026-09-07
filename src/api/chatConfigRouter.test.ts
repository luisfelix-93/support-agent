import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { Role } from '../domain/Role.js';

vi.mock('../config/container.js', () => ({
    chatConfigController: {
        register: vi.fn((req, res) => res.status(201).json({ success: true })),
        getByWorkspaceId: vi.fn((req, res) => res.status(200).json({ workspaceId: req.params.workspaceId })),
    },
}));

vi.mock('../usecases/LoginUserUseCase.js', () => ({
    LoginUserUseCase: {
        verify: vi.fn(),
    },
}));

import chatConfigRouter from './chatConfigRouter.js';
import { LoginUserUseCase } from '../usecases/LoginUserUseCase.js';
import { chatConfigController } from '../config/container.js';

describe('chatConfigRouter (Integration with tenantGuard & requireRole)', () => {
    let app: express.Express;
    let server: Server;
    let baseUrl: string;

    beforeEach(async () => {
        vi.clearAllMocks();

        app = express();
        app.use(express.json());
        app.use('/api', chatConfigRouter);

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

    describe('GET /api/chat-configs/:workspaceId', () => {
        it('deve retornar 401 se Authorization header estiver ausente', async () => {
            const res = await fetch(`${baseUrl}/chat-configs/ws-100`);

            expect(res.status).toBe(401);
            const data = await res.json();
            expect(data.error).toContain('Unauthorized');
        });

        it('deve retornar 403 se o usuário não pertencer ao workspace (cross-tenant)', async () => {
            vi.mocked(LoginUserUseCase.verify).mockResolvedValue({
                sub: 'user-1',
                email: 'user@example.com',
                role: Role.OPERATOR,
                workspaceIds: ['ws-other-tenant'],
            });

            const res = await fetch(`${baseUrl}/chat-configs/ws-100`, {
                headers: { Authorization: 'Bearer valid-jwt-token' },
            });

            expect(res.status).toBe(403);
            const data = await res.json();
            expect(data.error).toBe('Forbidden: access to this workspace is denied.');
            expect(chatConfigController.getByWorkspaceId).not.toHaveBeenCalled();
        });

        it('deve permitir acesso e retornar 200 se o usuário pertencer ao workspace', async () => {
            vi.mocked(LoginUserUseCase.verify).mockResolvedValue({
                sub: 'user-1',
                email: 'user@example.com',
                role: Role.OPERATOR,
                workspaceIds: ['ws-100', 'ws-200'],
            });

            const res = await fetch(`${baseUrl}/chat-configs/ws-100`, {
                headers: { Authorization: 'Bearer valid-jwt-token' },
            });

            expect(res.status).toBe(200);
            expect(chatConfigController.getByWorkspaceId).toHaveBeenCalled();
        });
    });

    describe('POST /api/chat-configs', () => {
        it('deve retornar 401 sem token', async () => {
            const res = await fetch(`${baseUrl}/chat-configs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workspaceId: 'ws-100' }),
            });

            expect(res.status).toBe(401);
        });

        it('deve retornar 403 se role não for ADMIN', async () => {
            vi.mocked(LoginUserUseCase.verify).mockResolvedValue({
                sub: 'user-1',
                email: 'user@example.com',
                role: Role.OPERATOR,
                workspaceIds: ['ws-100'],
            });

            const res = await fetch(`${baseUrl}/chat-configs`, {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer valid-jwt-token',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ workspaceId: 'ws-100' }),
            });

            expect(res.status).toBe(403);
            expect(chatConfigController.register).not.toHaveBeenCalled();
        });

        it('deve permitir criação se role for ADMIN', async () => {
            vi.mocked(LoginUserUseCase.verify).mockResolvedValue({
                sub: 'admin-1',
                email: 'admin@example.com',
                role: Role.ADMIN,
                workspaceIds: ['ws-100'],
            });

            const res = await fetch(`${baseUrl}/chat-configs`, {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer valid-jwt-token',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ workspaceId: 'ws-100' }),
            });

            expect(res.status).toBe(201);
            expect(chatConfigController.register).toHaveBeenCalled();
        });
    });
});
