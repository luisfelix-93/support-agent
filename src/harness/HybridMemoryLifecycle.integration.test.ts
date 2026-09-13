import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentHarness } from './AgentHarness.js';
import { ContextAssembler } from './ContextAssembler.js';
import { TiktokenAdapter } from '../infrastructure/tokenizer/TiktokenAdapter.js';
import { MongoMemoryRepository, type MemoryDocument } from '../repositories/MongoMemoryRepository.js';
import { ContextualMemoryReranker } from '../services/ContextualMemoryReranker.js';
import { MemoryLifecycle, type Memory } from '../domain/Memory.js';
import { ChatContext } from '../domain/ChatContext.js';
import { Message } from '../domain/Message.js';
import { MongoConnection } from '../infrastructure/database/MongoConnection.js';
import type { ILLMProvider, LLMResponse } from '../domain/ports/ILLMProvider.js';
import type { IMCPClient } from '../domain/ports/IMCPClient.js';
import type { IShortTermMemory } from '../domain/ports/IShortTermMemory.js';
import type { IEmbeddingProvider } from '../domain/ports/IEmbeddingProvider.js';

describe('Hybrid Memory & Lifecycle E2E Integration', () => {
    let memoryDb: Map<string, MemoryDocument>;
    let memoryRepository: MongoMemoryRepository;
    let reranker: ContextualMemoryReranker;
    let tokenCounter: TiktokenAdapter;
    let contextAssembler: ContextAssembler;
    let embeddingProvider: IEmbeddingProvider;

    const TENANT_ID = 'tenant-enterprise';
    const WORKSPACE_ID = 'ws-production';

    beforeEach(() => {
        vi.clearAllMocks();
        memoryDb = new Map();

        // Mock do MongoDB para simular comportamento real de coleções com suporte a $text, $regex e TTL
        vi.spyOn(MongoConnection, 'getDb').mockReturnValue({
            collection: (name: string) => {
                return {
                    createIndex: vi.fn().mockResolvedValue('index_created'),
                    findOne: vi.fn(async (filter) => {
                        for (const doc of memoryDb.values()) {
                            if (doc._id === filter._id && (!filter.tenantId || doc.tenantId === filter.tenantId)) {
                                return doc;
                            }
                        }
                        return null;
                    }),
                    find: vi.fn((filter) => {
                        let sortObj: any = null;
                        let limitVal: number = 100;
                        const cursor: any = {
                            sort: vi.fn((s) => {
                                sortObj = s;
                                return cursor;
                            }),
                            skip: vi.fn(() => cursor),
                            limit: vi.fn((l) => {
                                limitVal = l;
                                return cursor;
                            }),
                            toArray: vi.fn(async () => {
                                const results: MemoryDocument[] = [];
                                for (const doc of memoryDb.values()) {
                                    if (filter.tenantId && doc.tenantId !== filter.tenantId) continue;
                                    if (filter.workspaceId && doc.workspaceId !== filter.workspaceId) continue;
                                    if (filter.status?.$in && !filter.status.$in.includes(doc.status)) continue;
                                    if (filter.status && typeof filter.status === 'string' && doc.status !== filter.status) continue;
                                    if (filter.type?.$in && !filter.type.$in.includes(doc.type)) continue;

                                    // Verificação de expiração (TTL)
                                    if (filter.expiresAt?.$lte) {
                                        if (!doc.expiresAt || new Date(doc.expiresAt) > filter.expiresAt.$lte) {
                                            continue;
                                        }
                                    }

                                    // Text Search ($text)
                                    if (filter.$text?.$search) {
                                        const searchTerms = filter.$text.$search.toLowerCase().split(/\s+/).filter(Boolean);
                                        const content = (doc.content || '').toLowerCase();
                                        const tags = (doc.tags || []).map((t: string) => t.toLowerCase());
                                        let score = 0;
                                        for (const term of searchTerms) {
                                            if (tags.some((t: string) => t.includes(term))) score += 5;
                                            if (content.includes(term)) score += 1;
                                        }
                                        if (score === 0) continue;
                                        (doc as any).score = score;
                                    }

                                    // Filtro textual / regex em content e tags
                                    if (filter.$or) {
                                        const matchesOr = filter.$or.some((condition: any) => {
                                            if (condition.content?.$regex) {
                                                const rx = new RegExp(condition.content.$regex, condition.content.$options || 'i');
                                                return rx.test(doc.content);
                                            }
                                            if (condition.tags?.$regex) {
                                                const rx = new RegExp(condition.tags.$regex, condition.tags.$options || 'i');
                                                return (doc.tags || []).some(t => rx.test(t));
                                            }
                                            return false;
                                        });
                                        if (!matchesOr) continue;
                                    }

                                    results.push(doc);
                                }

                                if (sortObj?.score) {
                                    results.sort((a: any, b: any) => (b.score || 0) - (a.score || 0));
                                } else if (sortObj?.importance) {
                                    results.sort((a, b) => (b.importance || 0) - (a.importance || 0));
                                }

                                return results.slice(0, limitVal);
                            }),
                        };
                        return cursor;
                    }),
                    countDocuments: vi.fn(async (filter) => {
                        let count = 0;
                        for (const doc of memoryDb.values()) {
                            if (filter.tenantId && doc.tenantId !== filter.tenantId) continue;
                            if (filter.workspaceId && doc.workspaceId !== filter.workspaceId) continue;
                            if (filter.status && doc.status !== filter.status) continue;
                            count++;
                        }
                        return count;
                    }),
                    updateOne: vi.fn(async (filter, update) => {
                        const id = filter._id;
                        const existing = memoryDb.get(id) || ({ _id: id, tenantId: filter.tenantId } as MemoryDocument);
                        memoryDb.set(id, { ...existing, ...update.$set });
                        return { matchedCount: 1, modifiedCount: 1, upsertedCount: 1 };
                    }),
                    bulkWrite: vi.fn(async (ops) => {
                        for (const op of ops) {
                            if (op.updateOne) {
                                const id = op.updateOne.filter._id;
                                const doc = op.updateOne.update.$set;
                                const existing = memoryDb.get(id) || ({ _id: id, tenantId: op.updateOne.filter.tenantId } as MemoryDocument);
                                memoryDb.set(id, { ...existing, ...doc });
                            }
                        }
                        return { insertedCount: ops.length };
                    }),
                    deleteOne: vi.fn(async (filter) => {
                        const deleted = memoryDb.delete(filter._id);
                        return { deletedCount: deleted ? 1 : 0 };
                    }),
                    deleteMany: vi.fn(async (filter) => {
                        let deletedCount = 0;
                        if (filter.expiresAt?.$lte) {
                            for (const [id, doc] of Array.from(memoryDb.entries())) {
                                if (doc.expiresAt && new Date(doc.expiresAt) <= filter.expiresAt.$lte) {
                                    memoryDb.delete(id);
                                    deletedCount++;
                                }
                            }
                        }
                        return { deletedCount };
                    }),
                };
            },
        } as any);

        memoryRepository = new MongoMemoryRepository();
        reranker = new ContextualMemoryReranker();
        tokenCounter = new TiktokenAdapter();
        contextAssembler = new ContextAssembler(tokenCounter);

        embeddingProvider = {
            generateEmbedding: vi.fn(async (text: string) => {
                if (text.includes('database') || text.includes('banco')) {
                    return [0.95, 0.2, 0.05];
                }
                return [0.5, 0.5, 0.5];
            }),
            generateEmbeddings: vi.fn(async (texts: string[]) => {
                return texts.map(t => (t.includes('database') || t.includes('banco') ? [0.95, 0.2, 0.05] : [0.5, 0.5, 0.5]));
            }),
        };
    });

    it('1. Deve demonstrar que Busca Híbrida + RRF prioriza termo técnico exato sobre similaridade vetorial pura', async () => {
        const genericDbMemory: Memory = {
            id: 'mem-generic-db',
            tenantId: TENANT_ID,
            workspaceId: WORKSPACE_ID,
            type: 'fact',
            content: 'Boas práticas para banco de dados relacional: configurar connection pooling e timeouts.',
            importance: 0.7,
            status: 'active',
            tags: ['database', 'best-practices'],
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        const technicalIncidentMemory: Memory = {
            id: 'mem-incident-pool',
            tenantId: TENANT_ID,
            workspaceId: WORKSPACE_ID,
            type: 'incident',
            content: 'Incidente crítico no checkout-api com código ERR_DATABASE_POOL_EXHAUSTED: pool HikariCP esgotado. Solução: aumentar maxPoolSize para 30.',
            importance: 0.95,
            status: 'active',
            tags: ['checkout-api', 'database', 'hikari', 'ERR_DATABASE_POOL_EXHAUSTED'],
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await memoryRepository.saveBatch([genericDbMemory, technicalIncidentMemory]);

        const query = 'Erro crítico ERR_DATABASE_POOL_EXHAUSTED no checkout-api';
        const queryVector = [0.90, 0.25, 0.05];

        const hybridResults = await memoryRepository.searchHybrid({
            tenantId: TENANT_ID,
            workspaceId: WORKSPACE_ID,
            query,
            vector: queryVector,
            limit: 5,
        });

        expect(hybridResults.length).toBeGreaterThan(0);
        // O termo técnico exato impulsionou 'mem-incident-pool' na busca textual com score mais alto, ficando em rank 1
        expect(hybridResults[0].memory.id).toBe('mem-incident-pool');
        expect(hybridResults[0].textRank).toBe(1);
        expect(hybridResults[0].score).toBeGreaterThan(0);

        // Aplicando o ContextualMemoryReranker com bônus de termo técnico
        const reranked = await reranker.rerank(
            hybridResults,
            query
        );

        expect(reranked[0].memory.id).toBe('mem-incident-pool');
        expect(reranked[0].memory.content).toContain('ERR_DATABASE_POOL_EXHAUSTED');
    });

    it('2. Deve validar o ciclo de vida completo: candidate -> validated -> active, rejeitando transição inválida', async () => {
        const candidateMemory: Memory = {
            id: 'mem-lifecycle-1',
            tenantId: TENANT_ID,
            workspaceId: WORKSPACE_ID,
            type: 'fact',
            content: 'Fato operacional aguardando curadoria da equipe de suporte.',
            importance: 0.5,
            status: 'candidate',
            confidenceScore: 0.65,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await memoryRepository.save(candidateMemory);

        // 2.1 Verifica que está na fila de candidatos
        const candidates = await memoryRepository.findCandidates(TENANT_ID);
        expect(candidates.some(c => c.id === 'mem-lifecycle-1')).toBe(true);

        // 2.2 Transição ilegal: candidate não pode ir direto para updated
        const canJumpToUpdated = MemoryLifecycle.canTransition('candidate', 'updated');
        expect(canJumpToUpdated).toBe(false);

        // 2.3 Transição válida: candidate -> validated
        const canValidate = MemoryLifecycle.canTransition('candidate', 'validated');
        expect(canValidate).toBe(true);

        const validatedSuccess = await memoryRepository.updateStatus('mem-lifecycle-1', TENANT_ID, 'validated', {
            validatedBy: 'user-operator-1',
        });
        expect(validatedSuccess).toBe(true);

        const docAfterValidation = await memoryRepository.findById('mem-lifecycle-1', TENANT_ID);
        expect(docAfterValidation?.status).toBe('validated');
        expect(docAfterValidation?.validatedBy).toBe('user-operator-1');

        // 2.4 Transição válida: validated -> active
        const canActivate = MemoryLifecycle.canTransition('validated', 'active');
        expect(canActivate).toBe(true);

        await memoryRepository.updateStatus('mem-lifecycle-1', TENANT_ID, 'active');
        const docAfterActivation = await memoryRepository.findById('mem-lifecycle-1', TENANT_ID);
        expect(docAfterActivation?.status).toBe('active');

        // Agora não deve mais constar como candidate
        const candidatesAfter = await memoryRepository.findCandidates(TENANT_ID);
        expect(candidatesAfter.some(c => c.id === 'mem-lifecycle-1')).toBe(false);
    });

    it('3. Deve gerenciar expiração transitória com TTL e purga de memórias obsoletas', async () => {
        const now = new Date('2026-09-13T12:00:00Z');
        const expiredPast = new Date('2026-09-13T10:00:00Z');
        const futureExpiry = new Date('2026-09-13T14:00:00Z');

        const expiredIncidentMemory: Memory = {
            id: 'mem-expired-incident',
            tenantId: TENANT_ID,
            workspaceId: WORKSPACE_ID,
            type: 'incident',
            content: 'Incidente temporário no gateway resolvido após reboot do pod.',
            importance: 0.6,
            status: 'active',
            ttlSeconds: 3600,
            expiresAt: expiredPast,
            createdAt: new Date('2026-09-13T09:00:00Z'),
            updatedAt: new Date('2026-09-13T09:00:00Z'),
        };

        const validMemory: Memory = {
            id: 'mem-valid-incident',
            tenantId: TENANT_ID,
            workspaceId: WORKSPACE_ID,
            type: 'incident',
            content: 'Incidente recente em monitoramento.',
            importance: 0.8,
            status: 'active',
            ttlSeconds: 7200,
            expiresAt: futureExpiry,
            createdAt: now,
            updatedAt: now,
        };

        await memoryRepository.saveBatch([expiredIncidentMemory, validMemory]);

        const expiredList = await memoryRepository.findExpired(now);
        expect(expiredList.length).toBe(1);
        expect(expiredList[0].id).toBe('mem-expired-incident');

        const purgedCount = await memoryRepository.purgeExpired(now);
        expect(purgedCount).toBe(1);

        const remainingValid = await memoryRepository.findById('mem-valid-incident', TENANT_ID);
        expect(remainingValid).not.toBeNull();
        expect(remainingValid?.id).toBe('mem-valid-incident');

        const remainingExpired = await memoryRepository.findById('mem-expired-incident', TENANT_ID);
        expect(remainingExpired).toBeNull();
    });

    it('4. Deve executar o AgentHarness recuperando memória híbrida formatada com tags e status no prompt do LLM', async () => {
        const incidentKnowledge: Memory = {
            id: 'mem-k8s-dns',
            tenantId: TENANT_ID,
            workspaceId: WORKSPACE_ID,
            type: 'incident',
            content: 'No cluster de produção, o CoreDNS apresentava falhas intermitentes de timeout no kube-system. Solução aplicada: scale de réplicas de 2 para 4 e ajuste de limits de memória.',
            importance: 0.95,
            status: 'active',
            tags: ['coredns', 'kube-system', 'timeout', 'k8s'],
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await memoryRepository.save(incidentKnowledge);

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

        let capturedMemorySystemPrompt = '';
        const llmProvider: ILLMProvider = {
            providerName: 'google',
            modelName: 'gemini-2.0-flash',
            generateResponse: vi.fn(async (ctx: ChatContext): Promise<LLMResponse> => {
                const memMsg = ctx.messages.find((m: Message) => m.role === 'system' && m.content.includes('Contexto Relevante de Memória'));
                if (memMsg) {
                    capturedMemorySystemPrompt = memMsg.content;
                }
                return {
                    type: 'text',
                    content: 'Recomendo verificar as réplicas do CoreDNS no kube-system, que foram escaladas para 4 réplicas após o incidente anterior.',
                    usage: { inputTokens: 120, outputTokens: 35, totalTokens: 155 },
                };
            }),
        };

        const harness = new AgentHarness(
            contextAssembler,
            shortTermMemory,
            undefined,
            memoryRepository,
            undefined,
            embeddingProvider,
            undefined,
            reranker
        );

        const context = new ChatContext('thread-incident-1', WORKSPACE_ID);
        const userPrompt = 'Estamos enfrentando timeout intermitente no CoreDNS no kube-system. Já tivemos isso antes?';
        context.addMessage(new Message('m-1', 'user', userPrompt));

        const result = await harness.run({
            tenantId: TENANT_ID,
            workspaceId: WORKSPACE_ID,
            threadId: 'thread-incident-1',
            userMessage: userPrompt,
            context,
            llmProvider,
            mcpClient,
        });

        // 4.1 Validação do fluxo do AgentHarness
        expect(result.status).toBe('completed');
        expect(result.response).toContain('CoreDNS');
        expect(result.response).toContain('kube-system');

        // 4.2 Valida que o ContextAssembler formatou as memórias com tags e tipo no prompt
        expect(capturedMemorySystemPrompt).toContain('Contexto Relevante de Memória:');
        expect(capturedMemorySystemPrompt).toContain('[INCIDENT]');
        expect(capturedMemorySystemPrompt).toContain('[tags: coredns, kube-system, timeout, k8s]');
        expect(capturedMemorySystemPrompt).toContain('CoreDNS apresentava falhas intermitentes');
    });
});
