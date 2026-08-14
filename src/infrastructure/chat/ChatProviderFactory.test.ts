import { describe, it, expect, vi } from 'vitest';
import { ChatProviderFactory } from './ChatProviderFactory.js';
import { SlackChatAdapter } from './SlackChatAdapter.js';
import { GoogleChatAdapter } from './GoogleChatAdapter.js';
import { ChatConfig } from '../../domain/ChatConfig.js';
import type { IChatConfigRepository } from '../../domain/ports/IChatConfigRepository.js';

describe('ChatProviderFactory', () => {
    it('deve retornar GoogleChatAdapter quando fonte for google', async () => {
        const factory = new ChatProviderFactory({} as any);
        const provider = await factory.getProvider('tenant-1', 'google');
        expect(provider).toBeInstanceOf(GoogleChatAdapter);
    });

    it('deve instanciar SlackChatAdapter com botToken do banco quando ChatConfig existir', async () => {
        const mockConfig = new ChatConfig({
            workspaceId: 'tenant-1',
            teamId: 'T123',
            botToken: 'xoxb-db-token',
            signingSecret: 'sec-db',
        });

        const mockRepo: IChatConfigRepository = {
            findByWorkspaceId: vi.fn().mockResolvedValue(mockConfig),
            findByTeamId: vi.fn(),
            save: vi.fn(),
            delete: vi.fn(),
        };

        const factory = new ChatProviderFactory(mockRepo);
        const provider = await factory.getProvider('tenant-1', 'slack');

        expect(provider).toBeInstanceOf(SlackChatAdapter);
        expect(mockRepo.findByWorkspaceId).toHaveBeenCalledWith('tenant-1', 'slack');
    });

    it('deve usar fallbackSlackToken quando ChatConfig não existir no banco', async () => {
        const mockRepo: IChatConfigRepository = {
            findByWorkspaceId: vi.fn().mockResolvedValue(null),
            findByTeamId: vi.fn(),
            save: vi.fn(),
            delete: vi.fn(),
        };

        const factory = new ChatProviderFactory(mockRepo, 'xoxb-fallback-token');
        const provider = await factory.getProvider('tenant-1', 'slack');

        expect(provider).toBeInstanceOf(SlackChatAdapter);
    });

    it('deve lançar erro quando ChatConfig não existir e não houver fallback', async () => {
        const mockRepo: IChatConfigRepository = {
            findByWorkspaceId: vi.fn().mockResolvedValue(null),
            findByTeamId: vi.fn(),
            save: vi.fn(),
            delete: vi.fn(),
        };

        const factory = new ChatProviderFactory(mockRepo);
        await expect(factory.getProvider('tenant-1', 'slack')).rejects.toThrow(
            '[ChatProviderFactory] Nenhuma configuração de bot do Slack encontrada para o workspaceId: tenant-1'
        );
    });
});
