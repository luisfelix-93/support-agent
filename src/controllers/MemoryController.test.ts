import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryController } from './MemoryController.js';
import type { IMemoryRepository } from '../domain/ports/IMemoryRepository.js';
import type { IMemoryReranker } from '../domain/ports/IMemoryReranker.js';
import type { IEmbeddingProvider } from '../domain/ports/IEmbeddingProvider.js';
import type { Memory } from '../domain/Memory.js';

describe('MemoryController', () => {
    let controller: MemoryController;
    let mockRepository: any;
    let mockReranker: any;
    let mockEmbeddingProvider: any;
    let mockReq: any;
    let mockRes: any;

    beforeEach(() => {
        mockRepository = {
            find: vi.fn(),
            searchHybrid: vi.fn(),
            findCandidates: vi.fn(),
            findById: vi.fn(),
            updateStatus: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
        };

        mockReranker = {
            rerank: vi.fn(),
        };

        mockEmbeddingProvider = {
            generateEmbedding: vi.fn(),
        };

        controller = new MemoryController(
            mockRepository as IMemoryRepository,
            mockReranker as IMemoryReranker,
            mockEmbeddingProvider as IEmbeddingProvider
        );

        mockReq = {
            query: {},
            body: {},
            params: {},
            user: { userId: 'user-1', email: 'op@example.com', role: 'operator', tenantId: 'tenant-123' },
        };

        mockRes = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
        };
    });

    describe('list', () => {
        it('deve retornar 400 se tenantId não for fornecido', async () => {
            mockReq.user = undefined;
            mockReq.query = {};

            await controller.list(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
        });

        it('deve retornar 200 com lista de memórias paginada', async () => {
            mockReq.query = { status: 'active', limit: '10', offset: '0' };
            const mockMemories: Memory[] = [
                {
                    id: 'mem-1',
                    tenantId: 'tenant-123',
                    workspaceId: 'ws-1',
                    type: 'fact',
                    status: 'active',
                    content: 'PostgreSQL 15',
                    importance: 0.9,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                }
            ];

            mockRepository.find.mockResolvedValue({ total: 1, memories: mockMemories });

            await controller.list(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({
                success: true,
                data: {
                    total: 1,
                    limit: 10,
                    offset: 0,
                    memories: mockMemories,
                }
            });
        });
    });

    describe('search', () => {
        it('deve retornar 400 se query ou workspaceId estiverem ausentes', async () => {
            mockReq.body = { workspaceId: 'ws-1' }; // query ausente
            await controller.search(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(400);

            mockReq.body = { query: 'test' }; // workspaceId ausente
            await controller.search(mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(400);
        });

        it('deve executar busca híbrida e aplicar reranker', async () => {
            mockReq.body = {
                workspaceId: 'ws-1',
                query: 'timeout 504 checkout-api',
                limit: 5,
            };

            mockEmbeddingProvider.generateEmbedding.mockResolvedValue([0.1, 0.2]);
            const mockSearchResults = [
                {
                    memory: { id: 'mem-1', content: 'Erro 504', importance: 0.9 },
                    score: 0.8,
                }
            ];
            mockRepository.searchHybrid.mockResolvedValue(mockSearchResults);
            mockReranker.rerank.mockResolvedValue(mockSearchResults);

            await controller.search(mockReq, mockRes);

            expect(mockEmbeddingProvider.generateEmbedding).toHaveBeenCalledWith('timeout 504 checkout-api');
            expect(mockRepository.searchHybrid).toHaveBeenCalled();
            expect(mockReranker.rerank).toHaveBeenCalled();
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({
                success: true,
                count: 1,
                data: mockSearchResults,
            });
        });
    });

    describe('getCandidates', () => {
        it('deve retornar fila de candidatos do tenant', async () => {
            mockReq.query = { limit: '10' };
            mockRepository.findCandidates.mockResolvedValue([{ id: 'cand-1', status: 'candidate' }]);

            await controller.getCandidates(mockReq, mockRes);

            expect(mockRepository.findCandidates).toHaveBeenCalledWith('tenant-123', 10);
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({
                success: true,
                tenantId: 'tenant-123',
                count: 1,
                data: [{ id: 'cand-1', status: 'candidate' }],
            });
        });
    });

    describe('updateStatus', () => {
        it('deve retornar 400 se status for inválido', async () => {
            mockReq.params = { id: 'mem-1' };
            mockReq.body = { status: 'invalido' };

            await controller.updateStatus(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('Status inválido') }));
        });

        it('deve retornar 404 se a memória não existir', async () => {
            mockReq.params = { id: 'mem-inexistente' };
            mockReq.body = { status: 'validated' };
            mockRepository.findById.mockResolvedValue(null);

            await controller.updateStatus(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(404);
        });

        it('deve retornar 400 se a transição de status for inválida na máquina de estados', async () => {
            mockReq.params = { id: 'mem-1' };
            mockReq.body = { status: 'candidate' }; // active -> candidate não é permitido
            mockRepository.findById.mockResolvedValue({
                id: 'mem-1',
                tenantId: 'tenant-123',
                status: 'active',
            });

            await controller.updateStatus(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
                error: expect.stringContaining("Transição de status inválida de 'active' para 'candidate'")
            }));
        });

        it('deve permitir transição válida (candidate -> validated)', async () => {
            mockReq.params = { id: 'mem-1' };
            mockReq.body = { status: 'validated' };
            mockRepository.findById.mockResolvedValue({
                id: 'mem-1',
                tenantId: 'tenant-123',
                status: 'candidate',
            });
            mockRepository.updateStatus.mockResolvedValue(true);

            await controller.updateStatus(mockReq, mockRes);

            expect(mockRepository.updateStatus).toHaveBeenCalledWith(
                'mem-1',
                'tenant-123',
                'validated',
                expect.objectContaining({ validatedBy: 'op@example.com' })
            );
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({
                success: true,
                id: 'mem-1',
                status: 'validated',
                validatedBy: 'op@example.com',
            });
        });
    });

    describe('update', () => {
        it('deve atualizar campos de uma memória existente', async () => {
            mockReq.params = { id: 'mem-1' };
            mockReq.body = {
                content: 'Novo conteúdo corrigido',
                importance: 0.8,
                tags: ['tag1', 'tag2'],
            };
            mockRepository.findById.mockResolvedValue({ id: 'mem-1', tenantId: 'tenant-123' });
            mockRepository.update.mockResolvedValue({
                id: 'mem-1',
                tenantId: 'tenant-123',
                content: 'Novo conteúdo corrigido',
                importance: 0.8,
                tags: ['tag1', 'tag2'],
                status: 'updated',
            });

            await controller.update(mockReq, mockRes);

            expect(mockRepository.update).toHaveBeenCalledWith(
                'mem-1',
                'tenant-123',
                expect.objectContaining({
                    content: 'Novo conteúdo corrigido',
                    importance: 0.8,
                    tags: ['tag1', 'tag2'],
                })
            );
            expect(mockRes.status).toHaveBeenCalledWith(200);
        });
    });

    describe('delete', () => {
        it('deve retornar 404 se memória não for encontrada', async () => {
            mockReq.params = { id: 'mem-1' };
            mockRepository.delete.mockResolvedValue(false);

            await controller.delete(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(404);
        });

        it('deve retornar 200 se memória for removida com sucesso', async () => {
            mockReq.params = { id: 'mem-1' };
            mockRepository.delete.mockResolvedValue(true);

            await controller.delete(mockReq, mockRes);

            expect(mockRepository.delete).toHaveBeenCalledWith('mem-1', 'tenant-123');
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({
                success: true,
                id: 'mem-1',
                message: 'Memória removida com sucesso.',
            });
        });
    });
});
