import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TenantRepository } from './TenantRepository.js';
import { Tenant, type MCPServerConfig } from '../domain/Tenant.js';
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
                        mcpServers: [
                            {
                                id: 'default',
                                name: 'Default MCP Server',
                                url: 'https://mcp.acme.com',
                                apiKey: 'enc:mcp:mcp-secret-12345678',
                                enabled: true,
                            }
                        ],
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

        it('deve salvar e criptografar cada servidor na lista mcpServers', async () => {
            const multiServers: MCPServerConfig[] = [
                { id: 'k8s', name: 'Kubernetes MCP', url: 'https://k8s.acme.com', apiKey: 'k8s-secret-key', domains: ['kubernetes'] },
                { id: 'loki', name: 'Loki MCP', url: 'https://loki.acme.com', apiKey: 'loki-secret-key', domains: ['observability'] },
            ];

            const multiTenant = new Tenant(
                'ws-multi',
                dummyTenant.llmConfig,
                { url: 'https://k8s.acme.com', apiKey: 'k8s-secret-key' },
                true,
                multiServers
            );

            await repository.save(multiTenant);

            expect(mockEncryptionService.encrypt).toHaveBeenCalledWith('k8s-secret-key', 'mcp');
            expect(mockEncryptionService.encrypt).toHaveBeenCalledWith('loki-secret-key', 'mcp');

            expect(mockCollection.updateOne).toHaveBeenCalledWith(
                { workspaceId: 'ws-multi' },
                {
                    $set: expect.objectContaining({
                        workspaceId: 'ws-multi',
                        mcpServers: [
                            expect.objectContaining({
                                id: 'k8s',
                                apiKey: 'enc:mcp:k8s-secret-key',
                            }),
                            expect.objectContaining({
                                id: 'loki',
                                apiKey: 'enc:mcp:loki-secret-key',
                            }),
                        ],
                    }),
                },
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
            expect(result?.mcpServers).toHaveLength(1);
            expect(result?.mcpServers[0].apiKey).toBe('encrypted-mcp-key');
        });

        it('deve carregar e descriptografar múltiplos servidores MCP salvos em mcpServers', async () => {
            mockCollection.findOne.mockResolvedValue({
                workspaceId: 'ws-acme-multi',
                llmConfig: dummyTenant.llmConfig,
                mcpServers: [
                    { id: 'k8s', name: 'K8s', url: 'https://k8s.io', apiKey: 'iv:tag:secret-k8s', domains: ['k8s'] },
                    { id: 'db', name: 'DB', url: 'https://db.io', apiKey: 'iv:tag:secret-db', domains: ['database'] },
                ],
                isActive: true,
            });

            const result = await repository.findByWorkspaceId('ws-acme-multi');

            expect(result).not.toBeNull();
            expect(result?.mcpServers).toHaveLength(2);
            expect(result?.mcpServers[0].id).toBe('k8s');
            expect(result?.mcpServers[0].apiKey).toBe('secret-k8s');
            expect(result?.mcpServers[1].id).toBe('db');
            expect(result?.mcpServers[1].apiKey).toBe('secret-db');
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
            expect(result?.mcpServers[0].url).toBe('https://legacy-mcp.acme.com');
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
            expect(result?.mcpServers[0].apiKey).toBe('***...5678');
        });

        it('deve mascarar múltiplos servidores MCP em mcpServers', async () => {
            mockCollection.findOne.mockResolvedValue({
                workspaceId: 'ws-multi',
                llmConfig: dummyTenant.llmConfig,
                mcpServers: [
                    { id: 'k8s', name: 'K8s', url: 'https://k8s.io', apiKey: 'iv:tag:1234' },
                    { id: 'loki', name: 'Loki', url: 'https://loki.io', apiKey: 'iv:tag:long-secret-9999' }
                ],
                isActive: true,
            });

            const result = await repository.findByWorkspaceIdSafe('ws-multi');

            expect(result).not.toBeNull();
            expect(result?.mcpServers).toHaveLength(2);
            expect(result?.mcpServers[0].apiKey).toBe('****');
            expect(result?.mcpServers[1].apiKey).toBe('***...9999');
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
