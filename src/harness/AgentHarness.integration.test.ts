import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentHarness } from './AgentHarness.js';
import { ContextAssembler } from './ContextAssembler.js';
import { TiktokenAdapter } from '../infrastructure/tokenizer/TiktokenAdapter.js';
import { MongoMemoryRepository } from '../repositories/MongoMemoryRepository.js';
import { AgentRunRepository } from '../repositories/AgentRunRepository.js';
import { EvaluationRepository } from '../repositories/EvaluationRepository.js';
import { LLMMemoryExtractor } from '../infrastructure/memory/LLMMemoryExtractor.js';
import { MemoryPromotionWorker } from '../infrastructure/queue/MemoryPromotionWorker.js';
import { EvaluationWorker } from '../infrastructure/queue/EvaluationWorker.js';
import { LLMFactory } from '../infrastructure/llm/LLMFactory.js';
import { ChatContext } from '../domain/ChatContext.js';
import { Message } from '../domain/Message.js';
import { ToolCall } from '../domain/ToolCall.js';
import { Tenant } from '../domain/Tenant.js';
import { MongoConnection } from '../infrastructure/database/MongoConnection.js';
import type { ILLMProvider, LLMResponse } from '../domain/ports/ILLMProvider.js';
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

describe('AgentHarness Integration: Full Long-Term Memory & Evaluation Lifecycle', () => {
    let memoryDb: Map<string, any>;
    let runDb: Map<string, any>;
    let evalDb: Map<string, any>;
    let memoryRepository: MongoMemoryRepository;
    let agentRunRepository: AgentRunRepository;
    let tokenCounter: TiktokenAdapter;
    let contextAssembler: ContextAssembler;
    let embeddingProvider: IEmbeddingProvider;
    let queueService: IQueueService;
    let tenantRepository: ITenantRepository;
    let dispatchedMemoryJobs: any[];
    let dispatchedEvalJobs: any[];

    beforeEach(() => {
        vi.clearAllMocks();
        memoryDb = new Map();
        runDb = new Map();
        evalDb = new Map();
        dispatchedMemoryJobs = [];
        dispatchedEvalJobs = [];

        // Mock MongoDB suportando coleções distintas: 'memories', 'agent_runs' e 'evaluation_results'
        vi.spyOn(MongoConnection, 'getDb').mockReturnValue({
            collection: (name: string) => {
                if (name === 'agent_runs') {
                    return {
                        findOne: vi.fn(async (filter) => {
                            for (const doc of runDb.values()) {
                                if (filter.runId && doc.runId === filter.runId) return doc;
                            }
                            return null;
                        }),
                        find: vi.fn((filter) => ({
                            sort: vi.fn().mockReturnThis(),
                            skip: vi.fn().mockReturnThis(),
                            limit: vi.fn().mockReturnThis(),
                            toArray: vi.fn(async () =>
                                Array.from(runDb.values()).filter(d => !filter.tenantId || d.tenantId === filter.tenantId)
                            ),
                        })),
                        updateOne: vi.fn(async (filter, update) => {
                            const id = filter.runId || filter._id;
                            runDb.set(id, { runId: id, ...update.$set });
                        }),
                        createIndex: vi.fn().mockResolvedValue('index-created'),
                    };
                }

                if (name === 'evaluation_results') {
                    return {
                        findOne: vi.fn(async (filter) => {
                            for (const doc of evalDb.values()) {
                                if (filter.runId && doc.runId === filter.runId) return doc;
                            }
                            return null;
                        }),
                        find: vi.fn((filter) => ({
                            sort: vi.fn().mockReturnThis(),
                            skip: vi.fn().mockReturnThis(),
                            limit: vi.fn().mockReturnThis(),
                            toArray: vi.fn(async () =>
                                Array.from(evalDb.values()).filter(d => !filter.tenantId || d.tenantId === filter.tenantId)
                            ),
                        })),
                        updateOne: vi.fn(async (filter, update) => {
                            const id = filter.runId || filter._id;
                            evalDb.set(id, { runId: id, ...update.$set });
                        }),
                        createIndex: vi.fn().mockResolvedValue('index-created'),
                    };
                }

                // Default: collection 'memories'
                return {
                    findOne: vi.fn(async (filter) => {
                        for (const doc of memoryDb.values()) {
                            if (doc._id === filter._id && (!filter.tenantId || doc.tenantId === filter.tenantId)) {
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
                            for (const doc of memoryDb.values()) {
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
                        memoryDb.set(id, { _id: id, ...update.$set });
                    }),
                    bulkWrite: vi.fn(async (ops) => {
                        for (const op of ops) {
                            if (op.updateOne) {
                                const id = op.updateOne.filter._id;
                                memoryDb.set(id, { _id: id, ...op.updateOne.update.$set });
                            }
                        }
                    }),
                    deleteOne: vi.fn(async (filter) => {
                        const deleted = memoryDb.delete(filter._id);
                        return { deletedCount: deleted ? 1 : 0 };
                    }),
                };
            },
        } as any);

        memoryRepository = new MongoMemoryRepository();
        agentRunRepository = new AgentRunRepository();
        tokenCounter = new TiktokenAdapter();
        contextAssembler = new ContextAssembler(tokenCounter);

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
            dispatchMessageProcessing: vi.fn().mockResolvedValue(undefined),
            dispatchMemoryPromotion: vi.fn(async (tenantId, workspaceId, threadId, messages) => {
                dispatchedMemoryJobs.push({ tenantId, workspaceId, threadId, messages });
            }),
            dispatchEvaluation: vi.fn(async (runId, tenantId, workspaceId, payload) => {
                dispatchedEvalJobs.push({ runId, tenantId, workspaceId, payload });
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

    it('deve executar o ciclo completo: processar mensagem, persistir AgentRun com métricas, disparar promoção e auto-avaliação, e recuperar memória na conversa seguinte', async () => {
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
            providerName: 'google',
            modelName: 'gemini-2.0-flash',
            generateResponse: vi.fn().mockResolvedValue({
                type: 'text',
                content: 'Entendido! Registrei que o cluster roda em sa-east-1.',
                usage: {
                    inputTokens: 80,
                    outputTokens: 25,
                    totalTokens: 105,
                },
            }),
        };

        const harness = new AgentHarness(
            contextAssembler,
            shortTermMemory,
            undefined,
            memoryRepository,
            queueService,
            embeddingProvider,
            agentRunRepository
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

        // 1.1 Validações do resultado do primeiro run
        expect(result1.status).toBe('completed');
        expect(result1.response).toBe('Entendido! Registrei que o cluster roda em sa-east-1.');

        // 1.2 Valida que o AgentRun foi persistido no MongoDB
        expect(runDb.size).toBe(1);
        const savedRun1 = runDb.get(result1.runId);
        expect(savedRun1).toBeDefined();
        expect(savedRun1.runId).toBe(result1.runId);
        expect(savedRun1.tenantId).toBe('tenant-enterprise');
        expect(savedRun1.totalTokens).toBe(105);
        expect(savedRun1.status).toBe('completed');
        expect(savedRun1.llmCalls).toHaveLength(1);
        expect(savedRun1.llmCalls[0].provider).toBe('google');
        expect(savedRun1.llmCalls[0].model).toBe('gemini-2.0-flash');
        expect(savedRun1.costUsd).toBeGreaterThanOrEqual(0);

        // 1.3 Valida que os jobs assíncronos foram disparados
        expect(dispatchedMemoryJobs).toHaveLength(1);
        expect(dispatchedMemoryJobs[0]).toEqual(
            expect.objectContaining({
                tenantId: 'tenant-enterprise',
                workspaceId: 'ws-prod',
                threadId: 'thread-1',
            })
        );

        expect(dispatchedEvalJobs).toHaveLength(1);
        expect(dispatchedEvalJobs[0]).toEqual(
            expect.objectContaining({
                runId: result1.runId,
                tenantId: 'tenant-enterprise',
                workspaceId: 'ws-prod',
                payload: expect.objectContaining({
                    userMessage: 'O nosso cluster de Kubernetes roda na região sa-east-1.',
                    finalResponse: 'Entendido! Registrei que o cluster roda em sa-east-1.',
                    totalTokens: 105,
                }),
            })
        );

        // ─── Execução do Worker em background ──────────────────────────
        const workerMemoryExtractor: LLMMemoryExtractor = {
            extract: async (input: any) => {
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
            data: dispatchedMemoryJobs[0],
        });

        // Verifica que a memória foi gravada no repositório com o vetor de embedding
        expect(memoryDb.size).toBe(1);
        const savedMemory = Array.from(memoryDb.values())[0];
        expect(savedMemory.content).toContain('sa-east-1');
        expect(savedMemory.embedding).toEqual([0.9, 0.1, 0.0]);

        // ─── Execução do EvaluationWorker em background ─────────────────
        const evaluationRepository = new EvaluationRepository();
        const evalWorker = new EvaluationWorker(
            {},
            tenantRepository,
            evaluationRepository,
            'agent-evaluation'
        );

        vi.spyOn(LLMFactory, 'create').mockReturnValue({
            providerName: 'google',
            modelName: 'gemini-2.0-flash',
            generateResponse: vi.fn().mockResolvedValue({
                type: 'text',
                content: JSON.stringify({
                    confidence: 0.98,
                    hallucinationRisk: 0.02,
                    contextRelevance: 0.95,
                    completeness: 1.0,
                    toolSelectionQuality: 1.0,
                    reasoning: 'Resposta precisa e factualmente fundamentada.',
                }),
            }),
        });

        evalWorker.start();
        const evalProcessor = vi.mocked(Worker).mock.calls[1][1] as any;

        await evalProcessor({
            id: 'job-eval-1',
            data: dispatchedEvalJobs[0],
        });

        expect(evalDb.size).toBe(1);
        const savedEval = evalDb.get(result1.runId);
        expect(savedEval).toBeDefined();
        expect(savedEval.runId).toBe(result1.runId);
        expect(savedEval.tenantId).toBe('tenant-enterprise');
        expect(savedEval.selfEval.confidence).toBe(0.98);
        expect(savedEval.selfEval.hallucinationRisk).toBe(0.02);
        expect(savedEval.compositeScore).toBeGreaterThan(0.9);

        // ─── Execução 2: Nova sessão de chat perguntando sobre a região ──
        let assembledContextCaptures: any;
        const llmConversation2: ILLMProvider = {
            providerName: 'google',
            modelName: 'gemini-2.0-flash',
            generateResponse: vi.fn(async (assembledCtx): Promise<LLMResponse> => {
                assembledContextCaptures = assembledCtx;
                return {
                    type: 'text',
                    content: 'Seu cluster Kubernetes roda na região sa-east-1.',
                    usage: {
                        inputTokens: 95,
                        outputTokens: 20,
                        totalTokens: 115,
                    },
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

        // Valida que o segundo run também foi persistido no MongoDB
        expect(runDb.size).toBe(2);
        const savedRun2 = runDb.get(result2.runId);
        expect(savedRun2).toBeDefined();
        expect(savedRun2.totalTokens).toBe(115);
        expect(savedRun2.memoriesInjected).toBe(1);

        // Valida que o segundo job de avaliação foi despachado
        expect(dispatchedEvalJobs).toHaveLength(2);
        expect(dispatchedEvalJobs[1].runId).toBe(result2.runId);
    });

    it('deve persistir AgentRun como failed quando ocorrer falha inesperada', async () => {
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

        const failingLlm: ILLMProvider = {
            providerName: 'google',
            modelName: 'gemini-2.0-flash',
            generateResponse: vi.fn().mockRejectedValue(new Error('LLM Service Unavailable')),
        };

        const harness = new AgentHarness(
            contextAssembler,
            shortTermMemory,
            undefined,
            memoryRepository,
            queueService,
            embeddingProvider,
            agentRunRepository
        );

        const context = new ChatContext('thread-err', 'ws-prod');
        const result = await harness.run({
            tenantId: 'tenant-enterprise',
            workspaceId: 'ws-prod',
            threadId: 'thread-err',
            userMessage: 'Olá',
            context,
            llmProvider: failingLlm,
            mcpClient,
        });

        expect(result.status).toBe('failed');
        expect(result.error).toContain('LLM Service Unavailable');

        // Deve ter gravado o run como falho no banco
        expect(runDb.size).toBe(1);
        const failedRun = runDb.get(result.runId);
        expect(failedRun).toBeDefined();
        expect(failedRun.status).toBe('failed');
        expect(failedRun.error).toContain('LLM Service Unavailable');

        // Não deve despachar auto-avaliação para runs que falharam
        expect(dispatchedEvalJobs).toHaveLength(0);
    });

    it('deve executar o ciclo com chamadas a ferramentas MCP, acumular métricas de múltiplos steps LLM e persistir AgentRun com auto-avaliação', async () => {
        const shortTermMemory: IShortTermMemory = {
            get: vi.fn().mockResolvedValue(null),
            set: vi.fn().mockResolvedValue(undefined),
            clear: vi.fn().mockResolvedValue(undefined),
        };

        const mcpClient: IMCPClient = {
            connect: vi.fn(),
            isConnected: vi.fn().mockReturnValue(true),
            listTools: vi.fn().mockResolvedValue({ tools: [] }),
            executeTool: vi.fn().mockResolvedValue({ status: 'healthy', replicas: 3 }),
            close: vi.fn(),
        };

        let step = 0;
        const llmProvider: ILLMProvider = {
            providerName: 'openai',
            modelName: 'gpt-4o',
            generateResponse: vi.fn(async (): Promise<LLMResponse> => {
                step++;
                if (step === 1) {
                    return {
                        type: 'tool_call',
                        tool: new ToolCall('k8s_cluster_status', { namespace: 'production' }),
                        usage: {
                            inputTokens: 120,
                            outputTokens: 30,
                            totalTokens: 150,
                        },
                    };
                }
                return {
                    type: 'text',
                    content: 'O cluster k8s está saudável com 3 réplicas ativas.',
                    usage: {
                        inputTokens: 160,
                        outputTokens: 25,
                        totalTokens: 185,
                    },
                };
            }),
        };

        const harness = new AgentHarness(
            contextAssembler,
            shortTermMemory,
            undefined,
            memoryRepository,
            queueService,
            embeddingProvider,
            agentRunRepository
        );

        const context = new ChatContext('thread-tools', 'ws-prod');
        const userMsg = 'Qual o status do cluster k8s em produção?';
        context.addMessage(new Message('m-tool-1', 'user', userMsg));

        const result = await harness.run({
            tenantId: 'tenant-enterprise',
            workspaceId: 'ws-prod',
            threadId: 'thread-tools',
            userMessage: userMsg,
            context,
            llmProvider,
            mcpClient,
            tools: [{ name: 'k8s_cluster_status', description: 'Verifica saúde do k8s' }],
        });

        // 1. Valida resultado final
        expect(result.status).toBe('completed');
        expect(result.response).toBe('O cluster k8s está saudável com 3 réplicas ativas.');

        // 2. Valida chamada de ferramenta via MCP
        expect(mcpClient.executeTool).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'k8s_cluster_status',
                parameters: { namespace: 'production' },
            })
        );

        // 3. Valida que o AgentRun foi persistido no MongoDB com métricas agregadas
        expect(runDb.size).toBe(1);
        const savedRun = runDb.get(result.runId);
        expect(savedRun).toBeDefined();
        expect(savedRun.status).toBe('completed');
        expect(savedRun.iterations).toBe(1);
        expect(savedRun.toolCalls).toHaveLength(1);
        expect(savedRun.toolCalls[0].toolName).toBe('k8s_cluster_status');

        // Total de tokens: 150 (chamada 1) + 185 (chamada 2) = 335
        expect(savedRun.totalInputTokens).toBe(120 + 160);
        expect(savedRun.totalOutputTokens).toBe(30 + 25);
        expect(savedRun.totalTokens).toBe(335);

        // 2 chamadas LLM registradas
        expect(savedRun.llmCalls).toHaveLength(2);
        expect(savedRun.llmCalls[0].provider).toBe('openai');
        expect(savedRun.llmCalls[0].model).toBe('gpt-4o');
        expect(savedRun.llmCalls[0].resultType).toBe('tool_call');
        expect(savedRun.llmCalls[1].resultType).toBe('text');
        expect(savedRun.costUsd).toBeGreaterThan(0);

        // 4. Valida despacho de avaliação com métricas consolidadas
        expect(dispatchedEvalJobs).toHaveLength(1);
        expect(dispatchedEvalJobs[0].runId).toBe(result.runId);
        expect(dispatchedEvalJobs[0].payload.totalTokens).toBe(335);
        expect(dispatchedEvalJobs[0].payload.finalResponse).toBe('O cluster k8s está saudável com 3 réplicas ativas.');
        expect(dispatchedEvalJobs[0].payload.iterations).toBe(1);
    });
});

