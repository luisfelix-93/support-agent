import { describe, it, expect, vi } from 'vitest';
import { AgentHarness } from './AgentHarness.js';
import { ContextAssembler } from './ContextAssembler.js';
import { TiktokenAdapter } from '../infrastructure/tokenizer/TiktokenAdapter.js';
import { ChatContext } from '../domain/ChatContext.js';
import { Message } from '../domain/Message.js';
import type { ILLMProvider } from '../domain/ports/ILLMProvider.js';
import type { IMCPClient } from '../domain/ports/IMCPClient.js';
import type { IShortTermMemory } from '../domain/ports/IShortTermMemory.js';

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

        return { llmProvider, mcpClient, shortTermMemory };
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
