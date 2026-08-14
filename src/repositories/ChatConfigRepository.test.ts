import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatConfigRepository } from './ChatConfigRepository.js';
import { ChatConfig } from '../domain/ChatConfig.js';
import type { IEncryptionService } from '../domain/ports/IEncryptionService.js';
import { MongoConnection } from '../infrastructure/database/MongoConnection.js';

describe('ChatConfigRepository', () => {
    let repository: ChatConfigRepository;
    let mockEncryptionService: IEncryptionService;
    let mockCollection: any;

    beforeEach(() => {
        mockEncryptionService = {
            encrypt: vi.fn((text: string) => `enc:${text}`),
            decrypt: vi.fn((text: string) => text.replace('enc:', '')),
        };

        mockCollection = {
            findOne: vi.fn(),
            updateOne: vi.fn(),
            deleteOne: vi.fn(),
        };

        vi.spyOn(MongoConnection, 'getDb').mockReturnValue({
            collection: () => mockCollection,
        } as any);

        repository = new ChatConfigRepository(mockEncryptionService);
    });

    it('deve criptografar tokens ao salvar uma configuração', async () => {
        const config = new ChatConfig({
            workspaceId: 'tenant-1',
            teamId: 'T123',
            botToken: 'xoxb-secret-token',
            signingSecret: 'my-signing-secret',
        });

        await repository.save(config);

        expect(mockEncryptionService.encrypt).toHaveBeenCalledWith('xoxb-secret-token');
        expect(mockEncryptionService.encrypt).toHaveBeenCalledWith('my-signing-secret');
        expect(mockCollection.updateOne).toHaveBeenCalledWith(
            { workspaceId: 'tenant-1', provider: 'slack' },
            {
                $set: expect.objectContaining({
                    workspaceId: 'tenant-1',
                    teamId: 'T123',
                    botToken: 'enc:xoxb-secret-token',
                    signingSecret: 'enc:my-signing-secret',
                }),
            },
            { upsert: true }
        );
    });

    it('deve descriptografar tokens ao buscar por workspaceId', async () => {
        mockCollection.findOne.mockResolvedValue({
            workspaceId: 'tenant-1',
            provider: 'slack',
            teamId: 'T123',
            botToken: 'enc:xoxb-secret-token',
            signingSecret: 'enc:my-signing-secret',
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        const result = await repository.findByWorkspaceId('tenant-1');

        expect(mockEncryptionService.decrypt).toHaveBeenCalledWith('enc:xoxb-secret-token');
        expect(mockEncryptionService.decrypt).toHaveBeenCalledWith('enc:my-signing-secret');
        expect(result).not.toBeNull();
        expect(result?.botToken).toBe('xoxb-secret-token');
        expect(result?.signingSecret).toBe('my-signing-secret');
    });

    it('deve descriptografar tokens ao buscar por teamId', async () => {
        mockCollection.findOne.mockResolvedValue({
            workspaceId: 'tenant-1',
            provider: 'slack',
            teamId: 'T123',
            botToken: 'enc:xoxb-secret-token',
            signingSecret: 'enc:my-signing-secret',
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        const result = await repository.findByTeamId('T123');

        expect(mockEncryptionService.decrypt).toHaveBeenCalledWith('enc:xoxb-secret-token');
        expect(result?.teamId).toBe('T123');
        expect(result?.botToken).toBe('xoxb-secret-token');
    });

    it('deve retornar null quando a configuração não for encontrada', async () => {
        mockCollection.findOne.mockResolvedValue(null);

        const result = await repository.findByWorkspaceId('non-existent');
        expect(result).toBeNull();
    });

    it('deve deletar uma configuração pelo workspaceId', async () => {
        await repository.delete('tenant-1');
        expect(mockCollection.deleteOne).toHaveBeenCalledWith({
            workspaceId: 'tenant-1',
            provider: 'slack',
        });
    });
});
