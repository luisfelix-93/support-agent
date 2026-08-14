import { describe, it, expect, vi } from 'vitest';
import { GetChatConfigUseCase } from './GetChatConfigUseCase.js';
import { ChatConfig } from '../domain/ChatConfig.js';
import type { IChatConfigRepository } from '../domain/ports/IChatConfigRepository.js';

describe('GetChatConfigUseCase', () => {
    it('deve buscar a configuração de chat por workspaceId', async () => {
        const mockConfig = new ChatConfig({
            workspaceId: 'tenant-123',
            teamId: 'T0123456',
            botToken: 'xoxb-bot-token',
            signingSecret: 'signing-secret',
        });

        const mockRepository: IChatConfigRepository = {
            findByWorkspaceId: vi.fn().mockResolvedValue(mockConfig),
            findByTeamId: vi.fn(),
            save: vi.fn(),
            delete: vi.fn(),
        };

        const usecase = new GetChatConfigUseCase(mockRepository);
        const result = await usecase.execute('tenant-123');

        expect(mockRepository.findByWorkspaceId).toHaveBeenCalledWith('tenant-123', 'slack');
        expect(result).toBe(mockConfig);
    });

    it('deve lançar erro se workspaceId for vazio', async () => {
        const mockRepository: IChatConfigRepository = {
            findByWorkspaceId: vi.fn(),
            findByTeamId: vi.fn(),
            save: vi.fn(),
            delete: vi.fn(),
        };

        const usecase = new GetChatConfigUseCase(mockRepository);
        await expect(usecase.execute('')).rejects.toThrow(
            '[GetChatConfigUseCase] workspaceId é obrigatório.'
        );
    });
});
