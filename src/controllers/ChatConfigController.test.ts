import { describe, it, expect, vi } from 'vitest';
import { ChatConfigController } from './ChatConfigController.js';
import { ChatConfig } from '../domain/ChatConfig.js';

describe('ChatConfigController', () => {
    it('deve cadastrar uma nova configuração e retornar HTTP 201 sem expor segredos', async () => {
        const mockConfig = new ChatConfig({
            workspaceId: 'w-1',
            teamId: 'T1',
            botToken: 'xoxb-1',
            signingSecret: 'sec-1',
        });

        const mockRegisterUseCase = {
            execute: vi.fn().mockResolvedValue(mockConfig),
        } as any;
        const mockGetUseCase = {} as any;

        const controller = new ChatConfigController(mockRegisterUseCase, mockGetUseCase);

        const req = {
            body: {
                workspaceId: 'w-1',
                teamId: 'T1',
                botToken: 'xoxb-1',
                signingSecret: 'sec-1',
            },
        } as any;

        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
        } as any;

        await controller.register(req, res);

        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'Configuração do Slack cadastrada com sucesso.',
                config: expect.objectContaining({
                    workspaceId: 'w-1',
                    botTokenConfigured: true,
                }),
            })
        );
    });

    it('deve retornar 400 se campos obrigatórios estiverem ausentes no cadastro', async () => {
        const controller = new ChatConfigController({} as any, {} as any);

        const req = { body: { workspaceId: 'w-1' } } as any;
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
        } as any;

        await controller.register(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
    });

    it('deve retornar 404 se a busca não encontrar a configuração', async () => {
        const mockGetUseCase = {
            execute: vi.fn().mockResolvedValue(null),
        } as any;

        const controller = new ChatConfigController({} as any, mockGetUseCase);

        const req = { params: { workspaceId: 'non-existent' }, query: {} } as any;
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
        } as any;

        await controller.getByWorkspaceId(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
    });
});
