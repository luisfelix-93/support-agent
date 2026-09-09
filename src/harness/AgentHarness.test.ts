import { describe, it, expect, vi } from 'vitest';
import { AgentHarness } from './AgentHarness.js';
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
            findByTenantId: vi.fn().mockResolvedValue([]),
            findByWorkspaceId: vi.fn().mockResolvedValue([]),
            findById: vi.fn().mockResolvedValue(null),
            delete: vi.fn().mockResolvedValue(true),
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
            content: 'Cliente possui plano Enterprise.',
            importance: 0.9,
            createdAt: new Date(),
            updatedAt: new Date()
        };

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
        const result = await harness.run({
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
        expect(result.status).toBe('completed');
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
});
