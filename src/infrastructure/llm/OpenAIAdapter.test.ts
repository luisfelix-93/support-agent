import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIAdapter } from './OpenAIAdapter.js';
import { ChatContext } from '../../domain/ChatContext.js';
import { Message } from '../../domain/Message.js';

const mockCreate = vi.fn();

vi.mock('openai', () => ({
    default: vi.fn().mockImplementation(function () {
        return {
            chat: {
                completions: {
                    create: mockCreate,
                },
            },
        };
    }),
}));

describe('OpenAIAdapter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('deve retornar resposta de texto com usage quando fornecido pela API', async () => {
        const adapter = new OpenAIAdapter('sk-test', 'gpt-4o');

        mockCreate.mockResolvedValueOnce({
            choices: [
                {
                    message: { content: 'Resposta de teste' },
                },
            ],
            usage: {
                prompt_tokens: 120,
                completion_tokens: 45,
                total_tokens: 165,
            },
        });

        const context = new ChatContext('t-1', 'ws-1', [new Message('m-1', 'user', 'Pergunta')]);
        const result = await adapter.generateResponse(context);

        expect(result).toEqual({
            type: 'text',
            content: 'Resposta de teste',
            usage: {
                inputTokens: 120,
                outputTokens: 45,
                totalTokens: 165,
            },
        });
        expect(adapter.providerName).toBe('openai');
        expect(adapter.modelName).toBe('gpt-4o');
    });

    it('deve retornar resposta de texto sem campo usage quando API não retornar usage', async () => {
        const adapter = new OpenAIAdapter('sk-test', 'gpt-4o');

        mockCreate.mockResolvedValueOnce({
            choices: [
                {
                    message: { content: 'Resposta sem usage' },
                },
            ],
        });

        const context = new ChatContext('t-1', 'ws-1', [new Message('m-1', 'user', 'Pergunta')]);
        const result = await adapter.generateResponse(context);

        expect(result).toEqual({
            type: 'text',
            content: 'Resposta sem usage',
        });
        expect(result.usage).toBeUndefined();
    });

    it('deve retornar tool_call com usage quando solicitado', async () => {
        const adapter = new OpenAIAdapter('sk-test', 'gpt-4o');

        mockCreate.mockResolvedValueOnce({
            choices: [
                {
                    message: {
                        tool_calls: [
                            {
                                type: 'function',
                                function: {
                                    name: 'buscar_cliente',
                                    arguments: JSON.stringify({ id: 'cli-1' }),
                                },
                            },
                        ],
                    },
                },
            ],
            usage: {
                prompt_tokens: 200,
                completion_tokens: 30,
                total_tokens: 230,
            },
        });

        const context = new ChatContext('t-1', 'ws-1', [new Message('m-1', 'user', 'Buscar cliente')]);
        const result = await adapter.generateResponse(context);

        expect(result.type).toBe('tool_call');
        if (result.type === 'tool_call') {
            expect(result.tool.name).toBe('buscar_cliente');
            expect(result.tool.parameters).toEqual({ id: 'cli-1' });
            expect(result.usage).toEqual({
                inputTokens: 200,
                outputTokens: 30,
                totalTokens: 230,
            });
        }
    });

    it('deve definir providerName como deepseek quando baseUrl incluir deepseek', () => {
        const adapter = new OpenAIAdapter('sk-test', 'deepseek-chat', 'https://api.deepseek.com');
        expect(adapter.providerName).toBe('deepseek');
        expect(adapter.modelName).toBe('deepseek-chat');
    });
});
