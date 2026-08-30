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
        };

        const embeddingProvider: IEmbeddingProvider = {
            generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
            generateEmbeddings: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
        };

        return { llmProvider, mcpClient, shortTermMemory, memoryRepository, queueService, embeddingProvider };
    };

    it('deve executar o fluxo de texto e retornar resultado completed', async () => {
        const { llmProvider, mcpClient, shortTermMemory } = makeMocks();
        vi.mocked(llmProvider.generateResponse).mockResolvedValue({
            type: 'text',
            content: 'Resposta do assistente'
        });

        const harness = new AgentHarness(contextAssembler, shortTermMemory);
        const context = new ChatContext('thread-1', 'ws-1');
        context.addMessage(new Message('m1', 'user', 'Olá'));

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
        expect(result.response).toBe('Resposta do assistente');
        expect(result.runId).toBeDefined();
        expect(shortTermMemory.set).toHaveBeenCalledOnce();
    });

    it('deve buscar memórias relevantes com busca vetorial e enfileirar promoção de memória', async () => {
        const { llmProvider, mcpClient, shortTermMemory, memoryRepository, queueService, embeddingProvider } = makeMocks();
        
        const mockMemories: Memory[] = [{
            id: 'mem-1',
            tenantId: 'tenant-1',
            workspaceId: 'ws-1',
            type: 'fact',
            content: 'PostgreSQL 15',
            importance: 0.9,
            createdAt: new Date(),
            updatedAt: new Date(),
        }];

        vi.mocked(memoryRepository.searchRelevant).mockResolvedValue(mockMemories);
        vi.mocked(llmProvider.generateResponse).mockResolvedValue({
            type: 'text',
            content: 'Memória utilizada com sucesso.'
        });

        const harness = new AgentHarness(
            contextAssembler,
            shortTermMemory,
            undefined,
            memoryRepository,
            queueService,
            embeddingProvider
        );

        const context = new ChatContext('thread-1', 'ws-1');
        context.addMessage(new Message('m1', 'user', 'Qual a versão do banco?'));

        const result = await harness.run({
            tenantId: 'tenant-1',
            workspaceId: 'ws-1',
            threadId: 'thread-1',
            userMessage: 'Qual a versão do banco?',
            context,
            llmProvider,
            mcpClient
        });

        expect(result.status).toBe('completed');
        expect(embeddingProvider.generateEmbedding).toHaveBeenCalledWith('Qual a versão do banco?');
        expect(memoryRepository.searchRelevant).toHaveBeenCalledWith({
            tenantId: 'tenant-1',
            workspaceId: 'ws-1',
            query: 'Qual a versão do banco?',
            vector: [0.1, 0.2, 0.3],
            limit: 5,
        });
        expect(queueService.dispatchMemoryPromotion).toHaveBeenCalledWith(
            'tenant-1',
            'ws-1',
            'thread-1',
            expect.any(Array)
        );
    });

    it('deve continuar a execução mesmo se a busca de memórias falhar', async () => {
        const { llmProvider, mcpClient, shortTermMemory, memoryRepository } = makeMocks();
        vi.mocked(memoryRepository.searchRelevant).mockRejectedValue(new Error('Mongo connection error'));
        vi.mocked(llmProvider.generateResponse).mockResolvedValue({
            type: 'text',
            content: 'Resposta sem memórias'
        });

        const harness = new AgentHarness(
            contextAssembler,
            shortTermMemory,
            undefined,
            memoryRepository
        );

        const context = new ChatContext('thread-1', 'ws-1');
        context.addMessage(new Message('m1', 'user', 'Olá'));

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
        expect(result.response).toBe('Resposta sem memórias');
    });

    it('deve executar o loop de ferramenta (tool_call) e finalizar com texto', async () => {
        const { llmProvider, mcpClient } = makeMocks();
        vi.mocked(llmProvider.generateResponse)
            .mockResolvedValueOnce({
                type: 'tool_call',
                tool: { name: 'get_logs', parameters: { query: 'error' } }
            })
            .mockResolvedValueOnce({
                type: 'text',
                content: 'Encontrei os logs.'
            });

        const harness = new AgentHarness(contextAssembler);
        const context = new ChatContext('thread-1', 'ws-1');

        const result = await harness.run({
            tenantId: 'tenant-1',
            workspaceId: 'ws-1',
            threadId: 'thread-1',
            userMessage: 'Buscar logs',
            context,
            llmProvider,
            mcpClient
        });

        expect(result.status).toBe('completed');
        expect(result.response).toBe('Encontrei os logs.');
        expect(result.iterations).toBe(1);
        expect(result.toolCalls.length).toBe(1);
        expect(result.toolCalls[0].toolName).toBe('get_logs');
    });

    it('deve lidar com erro na execução da ferramenta sem travar a execução', async () => {
        const { llmProvider, mcpClient } = makeMocks();
        vi.mocked(llmProvider.generateResponse)
            .mockResolvedValueOnce({
                type: 'tool_call',
                tool: { name: 'failing_tool', parameters: {} }
            })
            .mockResolvedValueOnce({
                type: 'text',
                content: 'Desculpe, ocorreu uma falha ao consultar a ferramenta.'
            });

        vi.mocked(mcpClient.executeTool).mockRejectedValue(new Error('MCP server error'));

        const harness = new AgentHarness(contextAssembler);
        const context = new ChatContext('thread-1', 'ws-1');

        const result = await harness.run({
            tenantId: 'tenant-1',
            workspaceId: 'ws-1',
            threadId: 'thread-1',
            userMessage: 'Testar falha',
            context,
            llmProvider,
            mcpClient
        });

        expect(result.status).toBe('completed');
        expect(result.response).toBe('Desculpe, ocorreu uma falha ao consultar a ferramenta.');
        expect(result.toolCalls[0].error).toContain('MCP server error');
    });
});
