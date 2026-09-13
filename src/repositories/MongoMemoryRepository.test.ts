import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MongoMemoryRepository } from './MongoMemoryRepository.js';
import type { Memory } from '../domain/Memory.js';
import { MongoConnection } from '../infrastructure/database/MongoConnection.js';

describe('MongoMemoryRepository', () => {
    let repository: MongoMemoryRepository;
    let mockCollection: any;

    beforeEach(() => {
        mockCollection = {
            findOne: vi.fn(),
            find: vi.fn(),
            updateOne: vi.fn(),
            bulkWrite: vi.fn(),
            deleteOne: vi.fn(),
            deleteMany: vi.fn(),
            createIndex: vi.fn(),
        };

        vi.spyOn(MongoConnection, 'getDb').mockReturnValue({
            collection: () => mockCollection,
        } as any);

        repository = new MongoMemoryRepository();
    });

    it('deve salvar uma memória isolada por tenantId', async () => {
        const memory: Memory = {
            id: 'mem-1',
            tenantId: 'tenant-123',
            workspaceId: 'workspace-456',
            type: 'fact',
            status: 'active',
            content: 'O banco de dados é PostgreSQL 15',
            importance: 0.9,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await repository.save(memory);

        expect(mockCollection.updateOne).toHaveBeenCalledWith(
            { _id: 'mem-1', tenantId: 'tenant-123' },
            {
                $set: expect.objectContaining({
                    _id: 'mem-1',
                    tenantId: 'tenant-123',
                    workspaceId: 'workspace-456',
                    type: 'fact',
                    status: 'active',
                    content: 'O banco de dados é PostgreSQL 15',
                    importance: 0.9,
                })
            },
            { upsert: true }
        );
    });

    it('deve realizar busca vetorial por similaridade de cosseno', async () => {
        const queryVector = [1.0, 0.0, 0.0];
        const mockDocs = [
            {
                _id: 'mem-similar',
                tenantId: 'tenant-123',
                workspaceId: 'workspace-456',
                type: 'fact',
                content: 'PostgreSQL 15',
                importance: 0.9,
                embedding: [0.99, 0.01, 0.0], // alta similaridade
                createdAt: new Date(),
                updatedAt: new Date(),
            },
            {
                _id: 'mem-different',
                tenantId: 'tenant-123',
                workspaceId: 'workspace-456',
                type: 'fact',
                content: 'MongoDB Atlas',
                importance: 0.8,
                embedding: [0.0, 1.0, 0.0], // ortogonal (baixa similaridade)
                createdAt: new Date(),
                updatedAt: new Date(),
            }
        ];

        const mockCursor = {
            toArray: vi.fn().mockResolvedValue(mockDocs),
        };
        mockCollection.find.mockReturnValue(mockCursor);

        const results = await repository.searchRelevant({
            tenantId: 'tenant-123',
            workspaceId: 'workspace-456',
            vector: queryVector,
            threshold: 0.7,
            limit: 5,
        });

        expect(mockCollection.find).toHaveBeenCalledWith({
            tenantId: 'tenant-123',
            workspaceId: 'workspace-456',
            embedding: { $exists: true, $ne: [] },
        });

        expect(results).toHaveLength(1);
        expect(results[0].id).toBe('mem-similar');
    });

    it('deve salvar um lote de memórias via bulkWrite', async () => {
        const memories: Memory[] = [
            {
                id: 'mem-1',
                tenantId: 'tenant-123',
                workspaceId: 'workspace-456',
                type: 'fact',
                status: 'active',
                content: 'Fato 1',
                importance: 0.8,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
            {
                id: 'mem-2',
                tenantId: 'tenant-123',
                workspaceId: 'workspace-456',
                type: 'preference',
                status: 'active',
                content: 'Prefere respostas em português',
                importance: 0.7,
                createdAt: new Date(),
                updatedAt: new Date(),
            }
        ];

        await repository.saveBatch(memories);

        expect(mockCollection.bulkWrite).toHaveBeenCalledTimes(1);
        const operations = mockCollection.bulkWrite.mock.calls[0][0];
        expect(operations).toHaveLength(2);
        expect(operations[0].updateOne.filter).toEqual({ _id: 'mem-1', tenantId: 'tenant-123' });
        expect(operations[1].updateOne.filter).toEqual({ _id: 'mem-2', tenantId: 'tenant-123' });
    });

    it('não deve chamar bulkWrite se o array de memórias estiver vazio', async () => {
        await repository.saveBatch([]);
        expect(mockCollection.bulkWrite).not.toHaveBeenCalled();
    });

    it('deve buscar memórias relevantes com filtros de tenant e query textual', async () => {
        const mockDocs = [
            {
                _id: 'mem-1',
                tenantId: 'tenant-123',
                workspaceId: 'workspace-456',
                type: 'fact',
                content: 'PostgreSQL 15 em produção',
                importance: 0.9,
                createdAt: new Date(),
                updatedAt: new Date(),
            }
        ];

        const mockCursor = {
            sort: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            toArray: vi.fn().mockResolvedValue(mockDocs),
        };

        mockCollection.find.mockReturnValue(mockCursor);

        const results = await repository.searchRelevant({
            tenantId: 'tenant-123',
            workspaceId: 'workspace-456',
            query: 'PostgreSQL',
            limit: 3,
        });

        expect(mockCollection.find).toHaveBeenCalledWith(
            expect.objectContaining({
                tenantId: 'tenant-123',
                workspaceId: 'workspace-456',
                content: { $regex: 'PostgreSQL', $options: 'i' },
            })
        );
        expect(mockCursor.sort).toHaveBeenCalledWith({ importance: -1, createdAt: -1 });
        expect(mockCursor.limit).toHaveBeenCalledWith(3);
        expect(results).toHaveLength(1);
        expect(results[0].id).toBe('mem-1');
        expect(results[0].content).toBe('PostgreSQL 15 em produção');
    });

    it('deve buscar por tenantId com limite padrão', async () => {
        const mockCursor = {
            sort: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            toArray: vi.fn().mockResolvedValue([]),
        };
        mockCollection.find.mockReturnValue(mockCursor);

        await repository.findByTenantId('tenant-123');

        expect(mockCollection.find).toHaveBeenCalledWith({ tenantId: 'tenant-123' });
        expect(mockCursor.limit).toHaveBeenCalledWith(20);
    });

    it('deve buscar por workspaceId com limite', async () => {
        const mockCursor = {
            sort: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            toArray: vi.fn().mockResolvedValue([]),
        };
        mockCollection.find.mockReturnValue(mockCursor);

        await repository.findByWorkspaceId('workspace-456', 10);

        expect(mockCollection.find).toHaveBeenCalledWith({ workspaceId: 'workspace-456' });
        expect(mockCursor.limit).toHaveBeenCalledWith(10);
    });

    it('deve buscar por ID respeitando tenantId', async () => {
        mockCollection.findOne.mockResolvedValue({
            _id: 'mem-1',
            tenantId: 'tenant-123',
            workspaceId: 'workspace-456',
            type: 'fact',
            content: 'Texto',
            importance: 0.5,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        const result = await repository.findById('mem-1', 'tenant-123');

        expect(mockCollection.findOne).toHaveBeenCalledWith({ _id: 'mem-1', tenantId: 'tenant-123' });
        expect(result).not.toBeNull();
        expect(result?.id).toBe('mem-1');
    });

    it('deve retornar null se não encontrar por ID', async () => {
        mockCollection.findOne.mockResolvedValue(null);

        const result = await repository.findById('mem-inexistente', 'tenant-123');

        expect(result).toBeNull();
    });

    it('deve deletar memória por ID e tenantId', async () => {
        mockCollection.deleteOne.mockResolvedValue({ deletedCount: 1 });

        const result = await repository.delete('mem-1', 'tenant-123');

        expect(mockCollection.deleteOne).toHaveBeenCalledWith({ _id: 'mem-1', tenantId: 'tenant-123' });
        expect(result).toBe(true);
    });

    describe('ensureIndexes', () => {
        it('deve criar índices de texto, TTL e multi-tenant', async () => {
            await repository.ensureIndexes();

            expect(mockCollection.createIndex).toHaveBeenCalledTimes(3);
            expect(mockCollection.createIndex).toHaveBeenCalledWith(
                { content: 'text', tags: 'text' },
                expect.objectContaining({ name: 'text_content_tags_idx' })
            );
            expect(mockCollection.createIndex).toHaveBeenCalledWith(
                { expiresAt: 1 },
                expect.objectContaining({ name: 'ttl_expires_at_idx', expireAfterSeconds: 0 })
            );
            expect(mockCollection.createIndex).toHaveBeenCalledWith(
                { tenantId: 1, workspaceId: 1, status: 1, createdAt: -1 },
                expect.objectContaining({ name: 'tenant_workspace_status_created_idx' })
            );
        });
    });

    describe('searchHybrid', () => {
        it('deve executar busca híbrida combinando vetorial e textual via RRF', async () => {
            const vectorDoc = {
                _id: 'mem-vec',
                tenantId: 'tenant-123',
                workspaceId: 'workspace-456',
                type: 'incident',
                status: 'active',
                content: 'Lentidão intermitente no gateway',
                importance: 0.8,
                embedding: [0.99, 0.01, 0.0],
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const textDoc = {
                _id: 'mem-text',
                tenantId: 'tenant-123',
                workspaceId: 'workspace-456',
                type: 'incident',
                status: 'active',
                content: 'Erro HTTP 504 Gateway Timeout no checkout-api',
                importance: 0.9,
                tags: ['checkout-api', '504'],
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            // Primeira chamada para busca vetorial
            const mockVectorCursor = {
                toArray: vi.fn().mockResolvedValue([vectorDoc]),
            };

            // Segunda chamada para busca textual ($text ou regex)
            const mockTextCursor = {
                projection: vi.fn().mockReturnThis(),
                sort: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                toArray: vi.fn().mockResolvedValue([textDoc]),
            };

            mockCollection.find
                .mockReturnValueOnce(mockVectorCursor)
                .mockReturnValueOnce(mockTextCursor);

            const results = await repository.searchHybrid({
                tenantId: 'tenant-123',
                workspaceId: 'workspace-456',
                query: 'checkout-api 504',
                vector: [1.0, 0.0, 0.0],
                limit: 5,
            });

            expect(results).toHaveLength(2);
            expect(results[0].memory).toBeDefined();
            expect(results[0].score).toBeGreaterThan(0);
            expect(['mem-text', 'mem-vec']).toContain(results[0].memory.id);
            expect(['mem-text', 'mem-vec']).toContain(results[1].memory.id);
        });

        it('deve filtrar por status padrão active e validated', async () => {
            const mockCursor = {
                toArray: vi.fn().mockResolvedValue([]),
                projection: vi.fn().mockReturnThis(),
                sort: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
            };
            mockCollection.find.mockReturnValue(mockCursor);

            await repository.searchHybrid({
                tenantId: 'tenant-123',
                workspaceId: 'workspace-456',
                query: 'database',
            });

            expect(mockCollection.find).toHaveBeenCalledWith(
                expect.objectContaining({
                    tenantId: 'tenant-123',
                    workspaceId: 'workspace-456',
                    status: { $in: ['active', 'validated'] },
                }),
                expect.anything()
            );
        });
    });

    describe('métodos de ciclo de vida', () => {
        it('deve atualizar status de uma memória', async () => {
            mockCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

            const success = await repository.updateStatus('mem-1', 'tenant-123', 'validated', { reviewer: 'operator-1' });

            expect(mockCollection.updateOne).toHaveBeenCalledWith(
                { _id: 'mem-1', tenantId: 'tenant-123' },
                {
                    $set: expect.objectContaining({
                        status: 'validated',
                        metadata: { reviewer: 'operator-1' },
                    })
                }
            );
            expect(success).toBe(true);
        });

        it('deve buscar memórias candidatas por tenant', async () => {
            const mockCursor = {
                sort: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                toArray: vi.fn().mockResolvedValue([
                    {
                        _id: 'cand-1',
                        tenantId: 'tenant-123',
                        workspaceId: 'ws-1',
                        type: 'fact',
                        status: 'candidate',
                        content: 'Fato candidato',
                        importance: 0.5,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    }
                ]),
            };
            mockCollection.find.mockReturnValue(mockCursor);

            const candidates = await repository.findCandidates('tenant-123', 10);

            expect(mockCollection.find).toHaveBeenCalledWith({ tenantId: 'tenant-123', status: 'candidate' });
            expect(candidates).toHaveLength(1);
            expect(candidates[0].status).toBe('candidate');
        });

        it('deve buscar memórias expiradas', async () => {
            const mockCursor = {
                limit: vi.fn().mockReturnThis(),
                toArray: vi.fn().mockResolvedValue([]),
            };
            mockCollection.find.mockReturnValue(mockCursor);

            const now = new Date();
            await repository.findExpired(now, 50);

            expect(mockCollection.find).toHaveBeenCalledWith(
                expect.objectContaining({
                    expiresAt: { $lte: now, $exists: true, $ne: null },
                    status: { $ne: 'expired' },
                })
            );
            expect(mockCursor.limit).toHaveBeenCalledWith(50);
        });

        it('deve expurgar memórias expiradas (purgeExpired)', async () => {
            mockCollection.deleteMany.mockResolvedValue({ deletedCount: 5 });

            const now = new Date();
            const purged = await repository.purgeExpired(now);

            expect(mockCollection.deleteMany).toHaveBeenCalledWith({
                expiresAt: { $lte: now, $exists: true, $ne: null },
            });
            expect(purged).toBe(5);
        });
    });
});
