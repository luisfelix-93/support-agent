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
});
