import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OnboardingController } from './OnboardingController.js';
import type { Request, Response } from 'express';

describe('OnboardingController', () => {
    let mockRegisterUserUseCase: any;
    let mockRegisterTenantUseCase: any;
    let mockRegisterSpaceUseCase: any;
    let mockAssociateTenantUseCase: any;
    let controller: OnboardingController;
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
        vi.clearAllMocks();

        mockRegisterUserUseCase = {
            execute: vi.fn().mockResolvedValue({ id: 'user-1', name: 'Alice', email: 'alice@example.com' }),
        };

        mockRegisterTenantUseCase = {
            execute: vi.fn().mockResolvedValue({ workspaceId: 'ws-acme' }),
        };

        mockRegisterSpaceUseCase = {
            execute: vi.fn().mockResolvedValue({ spaceId: 'space-1', workspaceId: 'ws-acme' }),
        };

        mockAssociateTenantUseCase = {
            execute: vi.fn().mockResolvedValue(undefined),
        };

        controller = new OnboardingController(
            mockRegisterUserUseCase,
            mockRegisterTenantUseCase,
            mockRegisterSpaceUseCase,
            mockAssociateTenantUseCase
        );

        res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
        };
    });

    describe('registerTenant', () => {
        it('deve registrar tenant com mcpConfig e retornar 201', async () => {
            req = {
                body: {
                    workspaceId: 'ws-acme',
                    llmConfig: { provider: 'openai', apiKey: 'sk-key', model: 'gpt-4o' },
                    mcpConfig: { url: 'https://mcp.acme.com', apiKey: 'mcp-key' },
                },
            };

            await controller.registerTenant(req as Request, res as Response);

            expect(mockRegisterTenantUseCase.execute).toHaveBeenCalledWith(req.body);
            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith({ workspaceId: 'ws-acme' });
        });

        it('deve registrar tenant com múltiplos servidores em mcpServers e retornar 201', async () => {
            req = {
                body: {
                    workspaceId: 'ws-multi',
                    llmConfig: { provider: 'google', apiKey: 'gemini-key', model: 'gemini-2.0-flash' },
                    mcpServers: [
                        { id: 'k8s', name: 'K8s', url: 'https://k8s.io', apiKey: 'k8s-secret' },
                        { id: 'loki', name: 'Loki', url: 'https://loki.io', apiKey: 'loki-secret' }
                    ],
                },
            };

            await controller.registerTenant(req as Request, res as Response);

            expect(mockRegisterTenantUseCase.execute).toHaveBeenCalledWith(req.body);
            expect(res.status).toHaveBeenCalledWith(201);
        });

        it('deve retornar 400 se workspaceId, llmConfig ou mcpConfig/mcpServers estiverem ausentes', async () => {
            req = {
                body: {
                    workspaceId: 'ws-incomplete',
                    llmConfig: { provider: 'openai', apiKey: 'sk-key' },
                },
            };

            await controller.registerTenant(req as Request, res as Response);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(mockRegisterTenantUseCase.execute).not.toHaveBeenCalled();
        });

        it('deve retornar 400 se useCase lançar erro de validação (ex: IDs duplicados)', async () => {
            mockRegisterTenantUseCase.execute.mockRejectedValueOnce(
                new Error('ID de servidor duplicado em "mcpServers": "k8s".')
            );

            req = {
                body: {
                    workspaceId: 'ws-dup',
                    llmConfig: { provider: 'openai', apiKey: 'sk-key' },
                    mcpServers: [{ id: 'k8s', url: 'https://k8s.com' }],
                },
            };

            await controller.registerTenant(req as Request, res as Response);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('duplicado') }));
        });

        it('deve retornar 409 se o tenant já existir', async () => {
            mockRegisterTenantUseCase.execute.mockRejectedValueOnce(
                new Error("Tenant with workspaceId 'ws-acme' already exists.")
            );

            req = {
                body: {
                    workspaceId: 'ws-acme',
                    llmConfig: { provider: 'openai', apiKey: 'sk-key' },
                    mcpConfig: { url: 'https://mcp.com', apiKey: 'key' },
                },
            };

            await controller.registerTenant(req as Request, res as Response);

            expect(res.status).toHaveBeenCalledWith(409);
        });
    });

    describe('registerUser', () => {
        it('deve registrar usuário com sucesso e retornar 201', async () => {
            req = {
                body: { name: 'Alice', email: 'alice@example.com', password: 'Password123!' },
            };

            await controller.registerUser(req as Request, res as Response);

            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith({ id: 'user-1', name: 'Alice', email: 'alice@example.com' });
        });

        it('deve retornar 400 se campos obrigatórios estiverem ausentes', async () => {
            req = { body: { name: 'Alice' } };

            await controller.registerUser(req as Request, res as Response);

            expect(res.status).toHaveBeenCalledWith(400);
        });
    });

    describe('registerSpace', () => {
        it('deve registrar space com sucesso e retornar 201', async () => {
            req = { body: { spaceId: 'spaces/AAA', workspaceId: 'ws-1' } };

            await controller.registerSpace(req as Request, res as Response);

            expect(res.status).toHaveBeenCalledWith(201);
        });

        it('deve retornar 400 se campos estiverem ausentes', async () => {
            req = { body: { spaceId: 'spaces/AAA' } };

            await controller.registerSpace(req as Request, res as Response);

            expect(res.status).toHaveBeenCalledWith(400);
        });
    });

    describe('associateTenant', () => {
        it('deve associar tenant com sucesso e retornar 200', async () => {
            req = {
                body: { workspaceId: 'ws-1' },
                user: { sub: 'user-123', email: 'user@example.com', role: 'admin' },
            } as any;

            await controller.associateTenant(req as Request, res as Response);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(mockAssociateTenantUseCase.execute).toHaveBeenCalledWith({ userId: 'user-123', workspaceId: 'ws-1' });
        });

        it('deve retornar 401 se usuário não estiver autenticado', async () => {
            req = { body: { workspaceId: 'ws-1' } };

            await controller.associateTenant(req as Request, res as Response);

            expect(res.status).toHaveBeenCalledWith(401);
        });
    });
});
