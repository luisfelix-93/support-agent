import { describe, it, expect, vi } from 'vitest';
import { RegisterChatConfigUseCase } from './RegisterChatConfigUseCase.js';
import type { IChatConfigRepository } from '../domain/ports/IChatConfigRepository.js';

describe('RegisterChatConfigUseCase', () => {
    it('deve registrar uma nova configuração de chat com sucesso', async () => {
        const mockRepository: IChatConfigRepository = {
            findByWorkspaceId: vi.fn(),
            findByTeamId: vi.fn(),
            save: vi.fn().mockResolvedValue(undefined),
            delete: vi.fn(),
        };

        const usecase = new RegisterChatConfigUseCase(mockRepository);
        const dto = {
            workspaceId: 'tenant-123',
            teamId: 'T0123456',
            botToken: 'xoxb-bot-token',
            signingSecret: 'signing-secret',
        };

        const result = await usecase.execute(dto);

        expect(mockRepository.save).toHaveBeenCalledOnce();
        expect(result.workspaceId).toBe('tenant-123');
        expect(result.teamId).toBe('T0123456');
        expect(result.botToken).toBe('xoxb-bot-token');
    });

    it('deve lançar erro se DTO for inválido', async () => {
        const mockRepository: IChatConfigRepository = {
            findByWorkspaceId: vi.fn(),
            findByTeamId: vi.fn(),
            save: vi.fn(),
            delete: vi.fn(),
        };

        const usecase = new RegisterChatConfigUseCase(mockRepository);
        const dto = {
            workspaceId: '',
            teamId: 'T123',
            botToken: 'token',
            signingSecret: 'secret',
        };

        await expect(usecase.execute(dto)).rejects.toThrow();
    });
});
