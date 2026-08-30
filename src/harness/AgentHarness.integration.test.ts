import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentHarness } from './AgentHarness.js';
import { ContextAssembler } from './ContextAssembler.js';
import { TiktokenAdapter } from '../infrastructure/tokenizer/TiktokenAdapter.js';
import { MongoMemoryRepository } from '../repositories/MongoMemoryRepository.js';
import { LLMMemoryExtractor } from '../infrastructure/memory/LLMMemoryExtractor.js';
import { MemoryPromotionWorker } from '../infrastructure/queue/MemoryPromotionWorker.js';
import { ChatContext } from '../domain/ChatContext.js';
import { Message } from '../domain/Message.js';
import { Tenant } from '../domain/Tenant.js';
import { MongoConnection } from '../infrastructure/database/MongoConnection.js';
import type { ILLMProvider } from '../domain/ports/ILLMProvider.js';
import type { IMCPClient } from '../domain/ports/IMCPClient.js';
import type { IShortTermMemory } from '../domain/ports/IShortTermMemory.js';
import type { IQueueService } from '../domain/ports/IQueueService.js';
import type { IEmbeddingProvider } from '../domain/ports/IEmbeddingProvider.js';
import type { ITenantRepository } from '../domain/ports/ITenantRepository.js';
import { Worker } from 'bullmq';

const mockWorkerOn = vi.fn();
vi.mock('bullmq', () => {
    return {
        Worker: vi.fn().mockImplementation(function () {
            return {
                on: mockWorkerOn,
                close: vi.fn().mockResolvedValue(undefined),
            };
        }),
    };
});

describe('AgentHarness Integration: Full Long-Term Memory Lifecycle', () => {
    let inMemoryDb: Map<string, any>;
    let mockCollection: any;
    let memoryRepository: MongoMemoryRepository;
    let tokenCounter: TiktokenAdapter;
    let contextAssembler: ContextAssembler;
    let memoryExtractor: LLMMemoryExtractor;
    let embeddingProvider: IEmbeddingProvider;
    let queueService: IQueueService;
    let tenantRepository: ITenantRepository;
    let dispatchedJobs: any[];

    beforeEach(() => {
        vi.clearAllMocks();
        inMemoryDb = new Map();
        dispatchedJobs = [];

        mockCollection = {
            findOne: vi.fn(async (filter) => {
                for (const doc of inMemoryDb.values()) {
                    if (doc._id === filter._id && doc.tenantId === filter.tenantId) {
                        return doc;
                    }
                }
                return null;
            }),
            find: vi.fn((filter) => ({
                sort: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                toArray: vi.fn(async () => {
                    const results: any[] = [];
                    for (const doc of inMemoryDb.values()) {
                        if (doc.tenantId === filter.tenantId && doc.workspaceId === filter.workspaceId) {
                            if (filter.content?.$regex) {
                                const regex = new RegExp(filter.content.$regex, filter.content.$options || '');
                                if (regex.test(doc.content)) {
                                    results.push(doc);
                                }
                            } else {
                                results.push(doc);
                            }
                        }
                    }
                    return results;
                }),
            })),
            updateOne: vi.fn(async (filter, update) => {
                const id = filter._id;
                inMemoryDb.set(id, { _id: id, ...update.$set });
            }),
            bulkWrite: vi.fn(async (ops) => {
                for (const op of ops) {
                    if (op.updateOne) {
                        const id = op.updateOne.filter._id;
                        inMemoryDb.set(id, { _id: id, ...op.updateOne.update.$set });
                    }
                }
            }),
            deleteOne: vi.fn(async (filter) => {
                const deleted = inMemoryDb.delete(filter._id);
                return { deletedCount: deleted ? 1 : 0 };
            }),
        };

        vi.spyOn(MongoConnection, 'getDb').mockReturnValue({
            collection: () => mockCollection,
        } as any);

        memoryRepository = new MongoMemoryRepository();
        tokenCounter = new TiktokenAdapter();
        contextAssembler = new ContextAssembler(tokenCounter);
        memoryExtractor = new LLMMemoryExtractor();

        // Provedor de Embeddings determinístico para teste
        embeddingProvider = {
            generateEmbedding: vi.fn(async (text: string) => {
                if (text.includes('sa-east-1') || text.includes('região') || text.includes('cluster')) {
                    return [0.9, 0.1, 0.0];
                }
                return [0.0, 0.9, 0.1];
            }),
            generateEmbeddings: vi.fn(async (texts: string[]) => {
                return texts.map(t => {
                    if (t.includes('sa-east-1') || t.includes('região') || t.includes('cluster')) {
                        return [0.9, 0.1, 0.0];
                    }
                    return [0.0, 0.9, 0.1];
                });
            }),
        };

        queueService = {
            dispatchMessageProcessing: vi.fn(),
            dispatchMemoryPromotion: vi.fn(async (tenantId, workspaceId, threadId, messages) => {
                dispatchedJobs.push({ tenantId, workspaceId, threadId, messages });
            }),
        };

        const tenant = new Tenant(
            'ws-prod',
            { provider: 'google', apiKey: 'fake-key', model: 'gemini-2.0-flash' },
            { url: 'http://localhost:3000', apiKey: 'mcp-key' },
            true
        );

        tenantRepository = {
            findByWorkspaceId: vi.fn().mockResolvedValue(tenant),
            save: vi.fn(),
        };
    });

    it('deve extrair memória na primeira conversa e recuperá-la via busca vetorial na segunda conversa', async () => {
        const shortTermMemory: IShortTermMemory = {
            get: vi.fn().mockResolvedValue(null),
            set: vi.fn().mockResolvedValue(undefined),
            clear: vi.fn().mockResolvedValue(undefined),
        };

        const mcpClient: IMCPClient = {
            connect: vi.fn(),
            isConnected: vi.fn().mockReturnValue(true),
            listTools: vi.fn().mockResolvedValue({ tools: [] }),
            executeTool: vi.fn().mockResolvedValue({}),
            close: vi.fn(),
        };

        const llmConversation1: ILLMProvider = {
            generateResponse: vi.fn().mockResolvedValue({
                type: 'text',
                content: 'Entendido! Registrei que o cluster roda em sa-east-1.',
            }),
        };

        const harness = new AgentHarness(
            contextAssembler,
            shortTermMemory,
            undefined,
            memoryRepository,
            queueService,
            embeddingProvider
        );

        // ─── Execução 1: Usuário informa fato ─────────────────────────
        const context1 = new ChatContext('thread-1', 'ws-prod');
        context1.addMessage(new Message('m1', 'user', 'O nosso cluster de Kubernetes roda na região sa-east-1.'));

        const result1 = await harness.run({
            tenantId: 'tenant-enterprise',
            workspaceId: 'ws-prod',
            threadId: 'thread-1',
            userMessage: 'O nosso cluster de Kubernetes roda na região sa-east-1.',
            context: context1,
            llmProvider: llmConversation1,
            mcpClient,
        });

        expect(result1.status).toBe('completed');
        expect(dispatchedJobs).toHaveLength(1);

        // ─── Execução do Worker em background ──────────────────────────
        const extractorLLMMock: ILLMProvider = {
            generateResponse: vi.fn().mockResolvedValue({
                type: 'text',
                content: JSON.stringify([
                    {
                        type: 'fact',
                        content: 'O cluster Kubernetes da infraestrutura está na região sa-east-1.',
                        importance: 0.95,
                    }
                ]),
            }),
        };

        // Simulamos o extrator usando o LLM mockado
        const workerMemoryExtractor: LLMMemoryExtractor = {
            extract: async (input) => {
                return [
                    {
                        id: 'mem-k8s',
                        tenantId: input.tenantId,
                        workspaceId: input.workspaceId,
                        threadId: input.threadId,
                        type: 'fact',
                        content: 'O cluster Kubernetes da infraestrutura está na região sa-east-1.',
                        importance: 0.95,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    }
                ];
            }
        } as any;

        const memoryWorker = new MemoryPromotionWorker(
            {},
            tenantRepository,
            workerMemoryExtractor,
            memoryRepository,
            embeddingProvider,
            'memory-promotion'
        );

        memoryWorker.start();
        const workerProcessor = vi.mocked(Worker).mock.calls[0][1] as any;

        await workerProcessor({
            id: 'job-1',
            data: dispatchedJobs[0],
        });

        // Verifica que a memória foi gravada no repositório com o vetor de embedding
        expect(inMemoryDb.size).toBe(1);
        const savedMemory = Array.from(inMemoryDb.values())[0];
        expect(savedMemory.content).toContain('sa-east-1');
        expect(savedMemory.embedding).toEqual([0.9, 0.1, 0.0]);

        // ─── Execução 2: Nova sessão de chat perguntando sobre a região ──
        let assembledContextCaptures: any;
        const llmConversation2: ILLMProvider = {
            generateResponse: vi.fn(async (assembledCtx) => {
                assembledContextCaptures = assembledCtx;
                return {
                    type: 'text',
                    content: 'Seu cluster Kubernetes roda na região sa-east-1.',
                };
            }),
        };

        const context2 = new ChatContext('thread-2', 'ws-prod');
        context2.addMessage(new Message('m2', 'user', 'Em qual região da nuvem nosso cluster opera?'));

        const result2 = await harness.run({
            tenantId: 'tenant-enterprise',
            workspaceId: 'ws-prod',
            threadId: 'thread-2',
            userMessage: 'Em qual região da nuvem nosso cluster opera?',
            context: context2,
            llmProvider: llmConversation2,
            mcpClient,
        });

        expect(result2.status).toBe('completed');
        expect(result2.response).toBe('Seu cluster Kubernetes roda na região sa-east-1.');

        // Valida que o ContextAssembler injetou a memória de longo prazo no prompt do LLM
        const memorySystemMessage = assembledContextCaptures.messages.find(
            (m: Message) => m.role === 'system' && m.content.includes('Contexto Relevante de Memória')
        );

        expect(memorySystemMessage).toBeDefined();
        expect(memorySystemMessage?.content).toContain('sa-east-1');
    });
});
