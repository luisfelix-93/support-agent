import { describe, it, expect, vi } from 'vitest';
import { AgentHarness, getToolCallSignature } from './AgentHarness.js';
import { ContextAssembler } from './ContextAssembler.js';
import { TiktokenAdapter } from '../infrastructure/tokenizer/TiktokenAdapter.js';
import { ChatContext } from '../domain/ChatContext.js';
import { Message } from '../domain/Message.js';
import type { ILLMProvider } from '../domain/ports/ILLMProvider.js';
import type { IMCPClient } from '../domain/ports/IMCPClient.js';
import type { IShortTermMemory } from '../domain/ports/IShortTermMemory.js';
import type { IMemoryRepository } from '../domain/ports/IMemoryRepository.js';
import type { IQueueService } from '../domain/ports/IQueueService.js';
import type { IEmbeddingProvider } from '../domain/ports/IEmbeddingProvider.js';
import type { IAgentRunRepository } from '../domain/ports/IAgentRunRepository.js';
import type { Memory } from '../domain/Memory.js';

describe('AgentHarness', () => {
    const tokenCounter = new TiktokenAdapter();
    const contextAssembler = new ContextAssembler(tokenCounter);

    const makeMocks = () => {
        const llmProvider: ILLMProvider = {
            generateResponse: vi.fn()
        };

        const mcpClient: IMCPClient = {
            connect: vi.fn(),
            isConnected: vi.fn().mockReturnValue(true),
            listTools: vi.fn().mockResolvedValue({ tools: [] }),
            executeTool: vi.fn().mockResolvedValue({ result: 'ok' }),
            close: vi.fn()
        };

        const shortTermMemory: IShortTermMemory = {
            get: vi.fn().mockResolvedValue(null),
            set: vi.fn().mockResolvedValue(undefined),
            clear: vi.fn().mockResolvedValue(undefined)
        };

        const memoryRepository: IMemoryRepository = {
            save: vi.fn().mockResolvedValue(undefined),
            saveBatch: vi.fn().mockResolvedValue(undefined),
            searchRelevant: vi.fn().mockResolvedValue([]),
            searchHybrid: vi.fn().mockResolvedValue([]),
            findByTenantId: vi.fn().mockResolvedValue([]),
            findByWorkspaceId: vi.fn().mockResolvedValue([]),
            findById: vi.fn().mockResolvedValue(null),
            delete: vi.fn().mockResolvedValue(true),
            find: vi.fn().mockResolvedValue({ total: 0, memories: [] }),
            update: vi.fn().mockResolvedValue(null),
            updateStatus: vi.fn().mockResolvedValue(true),
            findCandidates: vi.fn().mockResolvedValue([]),
            findExpired: vi.fn().mockResolvedValue([]),
            purgeExpired: vi.fn().mockResolvedValue(0),
        };

        const queueService: IQueueService = {
            dispatchMessageProcessing: vi.fn().mockResolvedValue(undefined),
            dispatchMemoryPromotion: vi.fn().mockResolvedValue(undefined),
            dispatchEvaluation: vi.fn().mockResolvedValue(undefined),
        };

        const embeddingProvider: IEmbeddingProvider = {
            generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
            generateEmbeddings: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
        };

        const agentRunRepository: IAgentRunRepository = {
            save: vi.fn().mockResolvedValue(undefined),
            findByRunId: vi.fn().mockResolvedValue(null),
            findByTenant: vi.fn().mockResolvedValue([]),
            findBySessionId: vi.fn().mockResolvedValue([]),
            aggregateCostByTenant: vi.fn().mockResolvedValue([]),
            aggregateToolAnalytics: vi.fn().mockResolvedValue([]),
            aggregateLLMAnalytics: vi.fn().mockResolvedValue([]),
        };

        return { llmProvider, mcpClient, shortTermMemory, memoryRepository, queueService, embeddingProvider, agentRunRepository };
    };

    it('deve executar o fluxo de texto e retornar resultado completed', async () => {
        const { llmProvider, mcpClient } = makeMocks();
        vi.mocked(llmProvider.generateResponse).mockResolvedValueOnce({
            type: 'text',
            content: 'Olá! Sou seu agente de suporte.'
        });

        const harness = new AgentHarness(contextAssembler);
        const context = new ChatContext('thread-1', 'ws-1');

        const result = await harness.run({
            tenantId: 'tenant-1',
            workspaceId: 'ws-1',
            threadId: 'thread-1',
            userMessage: 'Olá',
            context,
            llmProvider,
            mcpClient
        });

        expect(result.status).toBe('completed');
        expect(result.response).toBe('Olá! Sou seu agente de suporte.');
        expect(result.iterations).toBe(0);
        expect(result.toolCalls).toHaveLength(0);
        expect(result.tokens).toBeDefined();
        expect(result.tokens?.totalTokens).toBeGreaterThanOrEqual(0);
    });

    it('deve salvar resposta no shortTermMemory se fornecido', async () => {
        const { llmProvider, mcpClient, shortTermMemory } = makeMocks();
        vi.mocked(llmProvider.generateResponse).mockResolvedValueOnce({
            type: 'text',
            content: 'Mensagem salva.'
        });

        const harness = new AgentHarness(contextAssembler, shortTermMemory);
        const context = new ChatContext('thread-1', 'ws-1');

        await harness.run({
            tenantId: 'tenant-1',
            workspaceId: 'ws-1',
            threadId: 'thread-1',
            userMessage: 'Oi',
            context,
            llmProvider,
            mcpClient
        });

        expect(shortTermMemory.set).toHaveBeenCalledTimes(1);
        expect(shortTermMemory.set).toHaveBeenCalledWith(
            'ws-1',
            'thread-1',
            expect.arrayContaining([
                expect.objectContaining({ content: 'Mensagem salva.' })
            ])
        );
    });

    it('deve buscar e injetar memórias relevantes de longo prazo', async () => {
        const { llmProvider, mcpClient, memoryRepository, embeddingProvider } = makeMocks();
        const fakeMemory: Memory = {
            id: 'mem-1',
            tenantId: 'tenant-1',
            workspaceId: 'ws-1',
            type: 'fact',
            status: 'active',
            content: 'Cliente possui plano Enterprise.',
            importance: 0.9,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        vi.mocked(memoryRepository.searchHybrid).mockResolvedValueOnce([{
            memory: fakeMemory,
            score: 0.9,
            vectorRank: 1,
            textRank: 1,
        }]);
        vi.mocked(llmProvider.generateResponse).mockResolvedValueOnce({
            type: 'text',
            content: 'Identifiquei que você possui plano Enterprise!'
        });

        const harness = new AgentHarness(
            contextAssembler,
            undefined,
            undefined,
            memoryRepository,
            undefined,
            embeddingProvider
        );

        const context = new ChatContext('thread-1', 'ws-1');
        const result = await harness.run({
            tenantId: 'tenant-1',
            workspaceId: 'ws-1',
            threadId: 'thread-1',
            userMessage: 'Qual é o meu plano?',
            context,
            llmProvider,
            mcpClient
        });

        expect(memoryRepository.searchHybrid).toHaveBeenCalledWith(
            expect.objectContaining({
                tenantId: 'tenant-1',
                workspaceId: 'ws-1',
                query: 'Qual é o meu plano?'
            })
        );
        expect(result.status).toBe('completed');
    });

    it('deve usar searchRelevant como fallback caso searchHybrid não esteja definido', async () => {
        const { llmProvider, mcpClient, memoryRepository, embeddingProvider } = makeMocks();
        const fakeMemory: Memory = {
            id: 'mem-fallback',
            tenantId: 'tenant-1',
            workspaceId: 'ws-1',
            type: 'fact',
            status: 'active',
            content: 'Cliente possui plano Enterprise.',
            importance: 0.9,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        // Remove searchHybrid para simular repositório legado
        (memoryRepository as any).searchHybrid = undefined;
        vi.mocked(memoryRepository.searchRelevant).mockResolvedValueOnce([fakeMemory]);
        vi.mocked(llmProvider.generateResponse).mockResolvedValueOnce({
            type: 'text',
            content: 'Identifiquei que você possui plano Enterprise!'
        });

        const harness = new AgentHarness(
            contextAssembler,
            undefined,
            undefined,
            memoryRepository,
            undefined,
            embeddingProvider
        );

        const context = new ChatContext('thread-1', 'ws-1');
        await harness.run({
            tenantId: 'tenant-1',
            workspaceId: 'ws-1',
            threadId: 'thread-1',
            userMessage: 'Qual é o meu plano?',
            context,
            llmProvider,
            mcpClient
        });

        expect(memoryRepository.searchRelevant).toHaveBeenCalledWith(
            expect.objectContaining({
                tenantId: 'tenant-1',
                workspaceId: 'ws-1',
                query: 'Qual é o meu plano?'
            })
        );
    });

    it('deve executar o fluxo de ferramenta (tool_call) e resolver texto final', async () => {
        const { llmProvider, mcpClient } = makeMocks();
        vi.mocked(llmProvider.generateResponse)
            .mockResolvedValueOnce({
                type: 'tool_call',
                tool: { name: 'consultar_pedido', parameters: { id: 123 } } as any
            })
            .mockResolvedValueOnce({
                type: 'text',
                content: 'Seu pedido #123 está a caminho.'
            });

        vi.mocked(mcpClient.executeTool).mockResolvedValueOnce({ status: 'enviado' });

        const harness = new AgentHarness(contextAssembler);
        const context = new ChatContext('thread-1', 'ws-1');

        const result = await harness.run({
            tenantId: 'tenant-1',
            workspaceId: 'ws-1',
            threadId: 'thread-1',
            userMessage: 'Onde está meu pedido 123?',
            context,
            llmProvider,
            mcpClient
        });

        expect(result.status).toBe('completed');
        expect(result.iterations).toBe(1);
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0].toolName).toBe('consultar_pedido');
        expect(result.response).toBe('Seu pedido #123 está a caminho.');
    });

    it('deve respeitar maxIterations e gerar fallback se excedido', async () => {
        const { ExecutionPolicy } = await import('./ExecutionPolicy.js');
        const { llmProvider, mcpClient } = makeMocks();

        const policy = new ExecutionPolicy({ maxIterations: 1 });

        vi.mocked(llmProvider.generateResponse)
            .mockResolvedValueOnce({
                type: 'tool_call',
                tool: { name: 'tool_loop_1', parameters: {} } as any
            })
            .mockResolvedValueOnce({
                type: 'tool_call',
                tool: { name: 'tool_loop_2', parameters: {} } as any
            })
            .mockResolvedValueOnce({
                type: 'text',
                content: 'Resumo das informações.'
            });

        const harness = new AgentHarness(contextAssembler, undefined, policy);
        const context = new ChatContext('thread-1', 'ws-1');

        const result = await harness.run({
            tenantId: 'tenant-1',
            workspaceId: 'ws-1',
            threadId: 'thread-1',
            userMessage: 'Loop',
            context,
            llmProvider,
            mcpClient
        });

        expect(result.status).toBe('max_iterations');
        expect(result.response).toBe('Resumo das informações.');
    });

    it('deve realizar fallback sem ferramentas caso o Circuit Breaker já esteja aberto no início', async () => {
        const { llmProvider, mcpClient } = makeMocks();
        (mcpClient as any).getCircuitBreaker = vi.fn().mockReturnValue({
            isOpen: () => true
        });

        vi.mocked(llmProvider.generateResponse).mockResolvedValueOnce({
            type: 'text',
            content: 'Serviço temporariamente indisponível.'
        });

        const harness = new AgentHarness(contextAssembler);
        const context = new ChatContext('thread-1', 'ws-1');

        const result = await harness.run({
            tenantId: 'tenant-1',
            workspaceId: 'ws-1',
            threadId: 'thread-1',
            userMessage: 'Consultar API',
            context,
            llmProvider,
            mcpClient,
            tools: [{ name: 'qualquer_ferramenta' }]
        });

        expect(result.status).toBe('completed');
        expect(result.response).toBe('Serviço temporariamente indisponível.');
        expect(mcpClient.executeTool).not.toHaveBeenCalled();
    });

    it('deve efetuar fallback caso o Circuit Breaker abra durante a chamada de tool', async () => {
        const { CircuitBreakerOpenError } = await import('../infrastructure/resilience/CircuitBreaker.js');
        const { llmProvider, mcpClient } = makeMocks();

        vi.mocked(llmProvider.generateResponse)
            .mockResolvedValueOnce({
                type: 'tool_call',
                tool: { name: 'fragile_tool', parameters: {} } as any
            })
            .mockResolvedValueOnce({
                type: 'text',
                content: 'Circuito abriu, então respondi com fallback.'
            });

        vi.mocked(mcpClient.executeTool).mockRejectedValueOnce(
            new CircuitBreakerOpenError('mcp-circuit', 5000)
        );

        const harness = new AgentHarness(contextAssembler);
        const context = new ChatContext('thread-1', 'ws-1');

        const result = await harness.run({
            tenantId: 'tenant-1',
            workspaceId: 'ws-1',
            threadId: 'thread-1',
            userMessage: 'Testar CB aberto no meio',
            context,
            llmProvider,
            mcpClient,
            tools: [{ name: 'fragile_tool' }]
        });

        expect(result.status).toBe('completed');
        expect(result.response).toBe('Circuito abriu, então respondi com fallback.');
        expect(result.toolCalls[0].error).toContain('Circuito está ABERTO');
    });

    it('deve abortar e retornar falha quando o timeout global for atingido', async () => {
        const { ExecutionPolicy } = await import('./ExecutionPolicy.js');
        const { llmProvider, mcpClient } = makeMocks();

        // Configura timeout global minúsculo (10ms)
        const policy = new ExecutionPolicy({ maxRunTimeMs: 10, llmTimeoutMs: 50 });

        vi.mocked(llmProvider.generateResponse).mockImplementation(async () => {
            await new Promise((resolve) => setTimeout(resolve, 30));
            return { type: 'text', content: 'Demorou demais' };
        });

        const harness = new AgentHarness(contextAssembler, undefined, policy);
        const context = new ChatContext('thread-1', 'ws-1');

        const result = await harness.run({
            tenantId: 'tenant-1',
            workspaceId: 'ws-1',
            threadId: 'thread-1',
            userMessage: 'Teste timeout',
            context,
            llmProvider,
            mcpClient
        });

        expect(result.status).toBe('failed');
        expect(result.response).toContain('Tempo limite');
    });

    it('deve acumular LLMCallRecord, persistir AgentRun e despachar auto-avaliação', async () => {
        const mocks = makeMocks();
        const harness = new AgentHarness(
            contextAssembler,
            mocks.shortTermMemory,
            undefined,
            mocks.memoryRepository,
            mocks.queueService,
            mocks.embeddingProvider,
            mocks.agentRunRepository
        );

        vi.mocked(mocks.llmProvider.generateResponse).mockResolvedValueOnce({
            type: 'text',
            content: 'Resposta avaliada',
            usage: {
                inputTokens: 120,
                outputTokens: 40,
                totalTokens: 160,
            },
        });

        (mocks.llmProvider as any).providerName = 'openai';
        (mocks.llmProvider as any).modelName = 'gpt-4o';

        const context = new ChatContext('thread-eval', 'ws-eval');
        const result = await harness.run({
            tenantId: 'tenant-eval',
            workspaceId: 'ws-eval',
            threadId: 'thread-eval',
            userMessage: 'Como funciona o suporte?',
            context,
            llmProvider: mocks.llmProvider,
            mcpClient: mocks.mcpClient,
        });

        expect(result.status).toBe('completed');
        expect(mocks.agentRunRepository.save).toHaveBeenCalledTimes(1);

        const savedRun = vi.mocked(mocks.agentRunRepository.save).mock.calls[0][0];
        expect(savedRun.id).toBe(result.runId);
        expect(savedRun.tenantId).toBe('tenant-eval');
        expect(savedRun.userMessage).toBe('Como funciona o suporte?');
        expect(savedRun.finalResponse).toBe('Resposta avaliada');
        expect(savedRun.totalTokens).toBe(160);
        expect(savedRun.llmCalls).toHaveLength(1);
        expect(savedRun.llmCalls[0].provider).toBe('openai');
        expect(savedRun.llmCalls[0].model).toBe('gpt-4o');
        expect(savedRun.costUsd).toBeGreaterThan(0);

        expect(mocks.queueService.dispatchEvaluation).toHaveBeenCalledWith(
            result.runId,
            'tenant-eval',
            'ws-eval',
            expect.objectContaining({
                userMessage: 'Como funciona o suporte?',
                finalResponse: 'Resposta avaliada',
                totalTokens: 160,
            })
        );
    });

    it('deve repassar systemInstructions ao ContextAssembler e salvar playbookIds no AgentRun', async () => {
        const mocks = makeMocks();
        const spyAssemble = vi.spyOn(contextAssembler, 'assemble');

        vi.mocked(mocks.llmProvider.generateResponse).mockResolvedValueOnce({
            type: 'text',
            content: 'Investigação de playbook concluída.',
        });

        const harness = new AgentHarness(
            contextAssembler,
            mocks.shortTermMemory,
            undefined,
            mocks.memoryRepository,
            mocks.queueService,
            mocks.embeddingProvider,
            mocks.agentRunRepository
        );

        const context = new ChatContext('thread-pb', 'ws-pb');
        const result = await harness.run({
            tenantId: 'tenant-pb',
            workspaceId: 'ws-pb',
            threadId: 'thread-pb',
            userMessage: 'Erro 500 no checkout',
            context,
            llmProvider: mocks.llmProvider,
            mcpClient: mocks.mcpClient,
            systemInstructions: 'DIRETRIZ DE INVESTIGAÇÃO DE ERRO 500',
            playbookIds: ['api-error', 'latency'],
        });

        expect(result.status).toBe('completed');
        expect(result.playbookIds).toEqual(['api-error', 'latency']);
        expect(spyAssemble).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                systemInstructions: 'DIRETRIZ DE INVESTIGAÇÃO DE ERRO 500',
            })
        );

        expect(mocks.agentRunRepository.save).toHaveBeenCalledTimes(1);
        const savedRun = vi.mocked(mocks.agentRunRepository.save).mock.calls[0][0];
        expect(savedRun.playbookIds).toEqual(['api-error', 'latency']);
    });

    it('deve vincular sessionId ao AgentRun e retornar tokens acumulados no AgentRunResult', async () => {
        const mocks = makeMocks();
        vi.mocked(mocks.llmProvider.generateResponse).mockResolvedValueOnce({
            type: 'text',
            content: 'Análise concluída com sucesso.',
            usage: {
                inputTokens: 150,
                outputTokens: 50,
                totalTokens: 200,
            }
        });

        const harness = new AgentHarness(
            contextAssembler,
            mocks.shortTermMemory,
            undefined,
            mocks.memoryRepository,
            mocks.queueService,
            mocks.embeddingProvider,
            mocks.agentRunRepository
        );
        const context = new ChatContext('thread-sess-1', 'ws-1');

        const result = await harness.run({
            tenantId: 'tenant-1',
            workspaceId: 'ws-1',
            threadId: 'thread-sess-1',
            sessionId: 'sess-abc-999',
            userMessage: 'Investigar latency',
            context,
            llmProvider: mocks.llmProvider,
            mcpClient: mocks.mcpClient,
        });

        expect(result.status).toBe('completed');
        expect(result.tokens).toEqual({
            inputTokens: 150,
            outputTokens: 50,
            totalTokens: 200,
            costUsd: expect.any(Number),
        });

        expect(mocks.agentRunRepository.save).toHaveBeenCalledTimes(1);
        const savedRun = vi.mocked(mocks.agentRunRepository.save).mock.calls[0][0];
        expect(savedRun.sessionId).toBe('sess-abc-999');
        expect(savedRun.totalTokens).toBe(200);
    });

    describe('Fase 9B: Detector de Estagnação & Trava Anti-Loop', () => {
        it('getToolCallSignature deve gerar assinatura canônica normalizada ordenando chaves recursivamente', () => {
            const sig1 = getToolCallSignature({
                name: 'consultar_k8s',
                parameters: { namespace: 'default', pod: 'api-1', options: { tail: 100, follow: false } }
            });
            const sig2 = getToolCallSignature({
                name: 'consultar_k8s',
                parameters: { pod: 'api-1', namespace: 'default', options: { follow: false, tail: 100 } }
            });

            expect(sig1).toBe(sig2);
            expect(sig1).toBe('consultar_k8s:{"namespace":"default","options":{"follow":false,"tail":100},"pod":"api-1"}');
        });

        it('deve permitir execução até 12 iterações quando chamadas de ferramentas progridem normalmente', async () => {
            const { ExecutionPolicy } = await import('./ExecutionPolicy.js');
            const { llmProvider, mcpClient } = makeMocks();
            const policy = new ExecutionPolicy({ maxIterations: 12 });

            // Simula 12 decisões com ferramentas diferentes e depois resposta de texto
            for (let i = 1; i <= 12; i++) {
                vi.mocked(llmProvider.generateResponse).mockResolvedValueOnce({
                    type: 'tool_call',
                    tool: { name: `tool_step_${i}`, parameters: { step: i } } as any
                });
            }
            vi.mocked(llmProvider.generateResponse).mockResolvedValueOnce({
                type: 'text',
                content: 'Investigação aprofundada de 12 passos concluída.'
            });

            const harness = new AgentHarness(contextAssembler, undefined, policy);
            const context = new ChatContext('thread-deep-1', 'ws-1');

            const result = await harness.run({
                tenantId: 'tenant-1',
                workspaceId: 'ws-1',
                threadId: 'thread-deep-1',
                userMessage: 'Analisar incidente complexo',
                context,
                llmProvider,
                mcpClient,
                tools: [{ name: 'tool_step' }]
            });

            expect(result.status).toBe('completed');
            expect(result.iterations).toBe(12);
            expect(result.toolCalls).toHaveLength(12);
            expect(mcpClient.executeTool).toHaveBeenCalledTimes(12);
            expect(result.response).toBe('Investigação aprofundada de 12 passos concluída.');
        });

        it('deve abortar precocemente ao detectar chamadas consecutivas idênticas e acionar fallback de síntese', async () => {
            const { ExecutionPolicy } = await import('./ExecutionPolicy.js');
            const { llmProvider, mcpClient } = makeMocks();
            const policy = new ExecutionPolicy({ maxIterations: 12, maxIdenticalToolCalls: 2 });

            // 1ª chamada: ferramenta A com args { pod: 'auth-pod' } -> executa
            vi.mocked(llmProvider.generateResponse).mockResolvedValueOnce({
                type: 'tool_call',
                tool: { name: 'get_logs', parameters: { pod: 'auth-pod' } } as any
            });

            // 2ª chamada: exatamente a mesma ferramenta com mesmos args -> deve disparar loop_detected
            vi.mocked(llmProvider.generateResponse).mockResolvedValueOnce({
                type: 'tool_call',
                tool: { name: 'get_logs', parameters: { pod: 'auth-pod' } } as any
            });

            // Fallback: chamado sem ferramentas para resumir
            vi.mocked(llmProvider.generateResponse).mockResolvedValueOnce({
                type: 'text',
                content: 'Síntese das evidências obtidas antes da interrupção do loop.'
            });

            const harness = new AgentHarness(contextAssembler, undefined, policy);
            const context = new ChatContext('thread-loop-1', 'ws-1');

            const result = await harness.run({
                tenantId: 'tenant-1',
                workspaceId: 'ws-1',
                threadId: 'thread-loop-1',
                userMessage: 'Investigar repetição',
                context,
                llmProvider,
                mcpClient,
                tools: [{ name: 'get_logs' }]
            });

            expect(result.status).toBe('max_iterations');
            expect(result.response).toBe('Síntese das evidências obtidas antes da interrupção do loop.');
            // MCP só deve ter sido executado 1 vez (a 2ª chamada foi barrada pela trava anti-loop)
            expect(mcpClient.executeTool).toHaveBeenCalledTimes(1);
            expect(result.iterations).toBe(1);
            // Fallback deve ter sido chamado com array vazio de tools
            expect(vi.mocked(llmProvider.generateResponse).mock.calls[2][1]).toEqual([]);
        });

        it('deve resetar o contador consecutivo quando ferramentas alternam normalmente', async () => {
            const { ExecutionPolicy } = await import('./ExecutionPolicy.js');
            const { llmProvider, mcpClient } = makeMocks();
            const policy = new ExecutionPolicy({ maxIterations: 12, maxIdenticalToolCalls: 2 });

            // 1. Tool A
            vi.mocked(llmProvider.generateResponse).mockResolvedValueOnce({
                type: 'tool_call',
                tool: { name: 'tool_A', parameters: { id: 1 } } as any
            });
            // 2. Tool B (diferente -> reseta contador)
            vi.mocked(llmProvider.generateResponse).mockResolvedValueOnce({
                type: 'tool_call',
                tool: { name: 'tool_B', parameters: { id: 1 } } as any
            });
            // 3. Tool A novamente (não consecutiva -> permitida)
            vi.mocked(llmProvider.generateResponse).mockResolvedValueOnce({
                type: 'tool_call',
                tool: { name: 'tool_A', parameters: { id: 1 } } as any
            });
            // 4. Texto final
            vi.mocked(llmProvider.generateResponse).mockResolvedValueOnce({
                type: 'text',
                content: 'Finalizado sem disparar loop.'
            });

            const harness = new AgentHarness(contextAssembler, undefined, policy);
            const context = new ChatContext('thread-alternate-1', 'ws-1');

            const result = await harness.run({
                tenantId: 'tenant-1',
                workspaceId: 'ws-1',
                threadId: 'thread-alternate-1',
                userMessage: 'Testar alternância',
                context,
                llmProvider,
                mcpClient,
                tools: [{ name: 'tool_A' }, { name: 'tool_B' }]
            });

            expect(result.status).toBe('completed');
            expect(result.iterations).toBe(3);
            expect(mcpClient.executeTool).toHaveBeenCalledTimes(3);
            expect(result.response).toBe('Finalizado sem disparar loop.');
        });
    });
});

