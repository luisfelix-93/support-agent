import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnthropicAdapter } from './AnthropicAdapter.js';
import { ChatContext } from '../../domain/ChatContext.js';
import { Message } from '../../domain/Message.js';

const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
    default: vi.fn().mockImplementation(function () {
        return {
            messages: {
                create: mockCreate,
            },
        };
    }),
}));

describe('AnthropicAdapter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('deve retornar resposta de texto com usage quando fornecido pela API', async () => {
        const adapter = new AnthropicAdapter('sk-ant-test', 'claude-3-5-sonnet');

        mockCreate.mockResolvedValueOnce({
            content: [
                { type: 'text', text: 'Resposta Claude' },
            ],
            usage: {
                input_tokens: 150,
                output_tokens: 60,
            },
        });

        const context = new ChatContext('t-1', 'ws-1', [new Message('m-1', 'user', 'Pergunta')]);
        const result = await adapter.generateResponse(context);

        expect(result).toEqual({
            type: 'text',
            content: 'Resposta Claude',
            usage: {
                inputTokens: 150,
                outputTokens: 60,
                totalTokens: 210,
            },
        });
        expect(adapter.providerName).toBe('anthropic');
        expect(adapter.modelName).toBe('claude-3-5-sonnet');
    });

    it('deve retornar resposta de texto sem usage quando não retornado', async () => {
        const adapter = new AnthropicAdapter('sk-ant-test', 'claude-3-5-sonnet');

        mockCreate.mockResolvedValueOnce({
            content: [
                { type: 'text', text: 'Resposta Claude sem usage' },
            ],
        });

        const context = new ChatContext('t-1', 'ws-1', [new Message('m-1', 'user', 'Pergunta')]);
        const result = await adapter.generateResponse(context);

        expect(result).toEqual({
            type: 'text',
            content: 'Resposta Claude sem usage',
        });
        expect(result.usage).toBeUndefined();
    });

    it('deve retornar tool_call com usage quando solicitado', async () => {
        const adapter = new AnthropicAdapter('sk-ant-test', 'claude-3-5-sonnet');

        mockCreate.mockResolvedValueOnce({
            content: [
                {
                    type: 'tool_use',
                    id: 'tool-1',
                    name: 'consultar_saldo',
                    input: { conta: '123' },
                },
            ],
            usage: {
                input_tokens: 250,
                output_tokens: 40,
            },
        });

        const context = new ChatContext('t-1', 'ws-1', [new Message('m-1', 'user', 'Consultar saldo')]);
        const result = await adapter.generateResponse(context);

        expect(result.type).toBe('tool_call');
        if (result.type === 'tool_call') {
            expect(result.tool.name).toBe('consultar_saldo');
            expect(result.tool.parameters).toEqual({ conta: '123' });
            expect(result.usage).toEqual({
                inputTokens: 250,
                outputTokens: 40,
                totalTokens: 290,
            });
        }
    });
});
