import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TenantRepository } from './TenantRepository.js';
import { Tenant } from '../domain/Tenant.js';
import type { IEncryptionService } from '../domain/ports/IEncryptionService.js';
import { MongoConnection } from '../infrastructure/database/MongoConnection.js';

vi.mock('../infrastructure/database/MongoConnection.js', () => ({
    MongoConnection: {
        getDb: vi.fn(),
    },
}));

describe('TenantRepository', () => {
    let mockCollection: any;
    let mockEncryptionService: IEncryptionService;
    let repository: TenantRepository;

    const dummyTenant = new Tenant(
        'ws-acme',
        { provider: 'openai', apiKey: 'sk-llm-secret', model: 'gpt-4o' },
        { url: 'https://mcp.acme.com', apiKey: 'mcp-secret-12345678' },
        true
    );

    beforeEach(() => {
        vi.clearAllMocks();

        mockCollection = {
            findOne: vi.fn(),
            updateOne: vi.fn().mockResolvedValue({ acknowledged: true }),
        };

        vi.mocked(MongoConnection.getDb).mockReturnValue({
            collection: vi.fn().mockReturnValue(mockCollection),
        } as any);

        mockEncryptionService = {
            encrypt: vi.fn().mockImplementation((text: string, context?: string) => `enc:${context}:${text}`),
            decrypt: vi.fn().mockImplementation((cipher: string) => {
                const parts = cipher.split(':');
                return parts[parts.length - 1];
            }),
        };

        repository = new TenantRepository(mockEncryptionService);
    });

    describe('save', () => {
        it('deve criptografar mcpConfig.apiKey usando contexto "mcp" ao salvar', async () => {
            await repository.save(dummyTenant);

            expect(mockEncryptionService.encrypt).toHaveBeenCalledWith('mcp-secret-12345678', 'mcp');
            expect(mockCollection.updateOne).toHaveBeenCalledWith(
                { workspaceId: 'ws-acme' },
                {
                    $set: {
                        workspaceId: 'ws-acme',
                        llmConfig: dummyTenant.llmConfig,
                        mcpConfig: {
                            url: 'https://mcp.acme.com',
                            apiKey: 'enc:mcp:mcp-secret-12345678',
                        },
                        isActive: true,
                    },
                },
                { upsert: true }
            );
        });

        it('deve salvar apiKey vazia sem chamar encrypt se apiKey não for informada', async () => {
            const tenantWithoutApiKey = new Tenant(
                'ws-no-mcp',
                dummyTenant.llmConfig,
                { url: 'https://mcp.acme.com', apiKey: '' },
                true
            );

            await repository.save(tenantWithoutApiKey);

            expect(mockEncryptionService.encrypt).not.toHaveBeenCalled();
            expect(mockCollection.updateOne).toHaveBeenCalledWith(
                { workspaceId: 'ws-no-mcp' },
                expect.objectContaining({
                    $set: expect.objectContaining({
                        mcpConfig: {
                            url: 'https://mcp.acme.com',
                            apiKey: '',
                        },
                    }),
                }),
                { upsert: true }
            );
        });
    });

    describe('findByWorkspaceId', () => {
        it('deve retornar null se o tenant não for encontrado', async () => {
            mockCollection.findOne.mockResolvedValue(null);

            const result = await repository.findByWorkspaceId('ws-nonexistent');

            expect(result).toBeNull();
            expect(mockCollection.findOne).toHaveBeenCalledWith({ workspaceId: 'ws-nonexistent' });
        });

        it('deve descriptografar mcpConfig.apiKey ao carregar do banco', async () => {
            mockCollection.findOne.mockResolvedValue({
                workspaceId: 'ws-acme',
                llmConfig: dummyTenant.llmConfig,
                mcpConfig: {
                    url: 'https://mcp.acme.com',
                    apiKey: 'iv:tag:encrypted-mcp-key',
                },
                isActive: true,
            });

            const result = await repository.findByWorkspaceId('ws-acme');

            expect(result).not.toBeNull();
            expect(mockEncryptionService.decrypt).toHaveBeenCalledWith('iv:tag:encrypted-mcp-key', 'mcp');
            expect(result?.mcpConfig.apiKey).toBe('encrypted-mcp-key');
        });

        it('deve suportar campo legado mcpConfig.serverUrl', async () => {
            mockCollection.findOne.mockResolvedValue({
                workspaceId: 'ws-acme',
                llmConfig: dummyTenant.llmConfig,
                mcpConfig: {
                    serverUrl: 'https://legacy-mcp.acme.com',
                    apiKey: '',
                },
                isActive: true,
            });

            const result = await repository.findByWorkspaceId('ws-acme');

            expect(result?.mcpConfig.url).toBe('https://legacy-mcp.acme.com');
        });

        it('deve retornar o texto plano se a apiKey não tiver o formato cifrado de 3 partes', async () => {
            mockCollection.findOne.mockResolvedValue({
                workspaceId: 'ws-acme',
                llmConfig: dummyTenant.llmConfig,
                mcpConfig: {
                    url: 'https://mcp.acme.com',
                    apiKey: 'plaintext-unencrypted-key',
                },
                isActive: true,
            });

            const result = await repository.findByWorkspaceId('ws-acme');

            expect(mockEncryptionService.decrypt).not.toHaveBeenCalled();
            expect(result?.mcpConfig.apiKey).toBe('plaintext-unencrypted-key');
        });
    });

    describe('findByWorkspaceIdSafe', () => {
        it('deve retornar null se o tenant não for encontrado', async () => {
            mockCollection.findOne.mockResolvedValue(null);

            const result = await repository.findByWorkspaceIdSafe('ws-nonexistent');

            expect(result).toBeNull();
        });

        it('deve retornar o tenant com mcpConfig.apiKey mascarada com os últimos 4 caracteres', async () => {
            mockCollection.findOne.mockResolvedValue({
                workspaceId: 'ws-acme',
                llmConfig: dummyTenant.llmConfig,
                mcpConfig: {
                    url: 'https://mcp.acme.com',
                    apiKey: 'iv:tag:secret-12345678',
                },
                isActive: true,
            });

            const result = await repository.findByWorkspaceIdSafe('ws-acme');

            expect(result).not.toBeNull();
            expect(result?.workspaceId).toBe('ws-acme');
            expect(result?.mcpConfig.apiKey).toBe('***...5678');
        });

        it('deve mascarar como **** quando a chave possuir 4 caracteres ou menos', async () => {
            mockCollection.findOne.mockResolvedValue({
                workspaceId: 'ws-acme',
                llmConfig: dummyTenant.llmConfig,
                mcpConfig: {
                    url: 'https://mcp.acme.com',
                    apiKey: 'iv:tag:abc',
                },
                isActive: true,
            });

            const result = await repository.findByWorkspaceIdSafe('ws-acme');

            expect(result?.mcpConfig.apiKey).toBe('****');
        });

        it('deve retornar string vazia se a apiKey estiver vazia', async () => {
            mockCollection.findOne.mockResolvedValue({
                workspaceId: 'ws-acme',
                llmConfig: dummyTenant.llmConfig,
                mcpConfig: {
                    url: 'https://mcp.acme.com',
                    apiKey: '',
                },
                isActive: true,
            });

            const result = await repository.findByWorkspaceIdSafe('ws-acme');

            expect(result?.mcpConfig.apiKey).toBe('');
        });
    });
});
