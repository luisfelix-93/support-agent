import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiAdapter } from './GeminiAdapter.js';
import { ChatContext } from '../../domain/ChatContext.js';
import { Message } from '../../domain/Message.js';

// Mock do SDK @google/genai
const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => ({
    GoogleGenAI: vi.fn().mockImplementation(function () {
        return {
            models: {
                generateContent: mockGenerateContent,
            },
        };
    }),
}));

describe('GeminiAdapter', () => {
    let adapter: GeminiAdapter;

    beforeEach(() => {
        vi.clearAllMocks();
        adapter = new GeminiAdapter('fake-api-key', 'gemini-2.0-flash');
    });

    it('deve retornar uma resposta de texto simples', async () => {
        mockGenerateContent.mockResolvedValueOnce({
            candidates: [
                {
                    content: {
                        parts: [{ text: 'Olá! Como posso ajudar?' }],
                    },
                },
            ],
        });

        const context = new ChatContext('thread-1', 'workspace-1', [
            new Message('msg-1', 'user', 'Olá!'),
        ]);

        const result = await adapter.generateResponse(context);

        expect(result).toEqual({ type: 'text', content: 'Olá! Como posso ajudar?' });
    });

    it('deve retornar uma tool_call quando o modelo solicitar uma ferramenta', async () => {
        mockGenerateContent.mockResolvedValueOnce({
            candidates: [
                {
                    content: {
                        parts: [
                            {
                                functionCall: {
                                    name: 'check_logs',
                                    args: { service: 'auth-service' },
                                },
                            },
                        ],
                    },
                },
            ],
        });

        const context = new ChatContext('thread-2', 'workspace-1', [
            new Message('msg-1', 'user', 'Verifique os logs do auth-service'),
        ]);

        const result = await adapter.generateResponse(context);

        expect(result.type).toBe('tool_call');
        if (result.type === 'tool_call') {
            expect(result.tool.name).toBe('check_logs');
            expect(result.tool.parameters).toEqual({ service: 'auth-service' });
        }
    });

    it('deve propagar erro se a API do Gemini lançar uma exceção', async () => {
        mockGenerateContent.mockRejectedValueOnce(new Error('API key inválida'));

        const context = new ChatContext('thread-6', 'workspace-1', [
            new Message('msg-1', 'user', 'Olá'),
        ]);

        await expect(adapter.generateResponse(context)).rejects.toThrow('API key inválida');
    });

    it('deve extrair usageMetadata quando retornado pela API do Gemini', async () => {
        mockGenerateContent.mockResolvedValueOnce({
            candidates: [
                {
                    content: {
                        parts: [{ text: 'Resposta com usage' }],
                    },
                },
            ],
            usageMetadata: {
                promptTokenCount: 150,
                candidatesTokenCount: 50,
                totalTokenCount: 200,
            },
        });

        const context = new ChatContext('thread-7', 'workspace-1', [
            new Message('msg-1', 'user', 'Olá com métricas'),
        ]);

        const result = await adapter.generateResponse(context);

        expect(result).toEqual({
            type: 'text',
            content: 'Resposta com usage',
            usage: {
                inputTokens: 150,
                outputTokens: 50,
                totalTokens: 200,
            },
        });
        expect(adapter.providerName).toBe('google');
        expect(adapter.modelName).toBe('gemini-2.0-flash');
    });

    it('deve extrair usageMetadata em tool_call', async () => {
        mockGenerateContent.mockResolvedValueOnce({
            candidates: [
                {
                    content: {
                        parts: [
                            {
                                functionCall: {
                                    name: 'consultar_status',
                                    args: { id: 'ped-1' },
                                },
                            },
                        ],
                    },
                },
            ],
            usageMetadata: {
                promptTokenCount: 300,
                candidatesTokenCount: 60,
                totalTokenCount: 360,
            },
        });

        const context = new ChatContext('thread-8', 'workspace-1', [
            new Message('msg-1', 'user', 'Consultar status'),
        ]);

        const result = await adapter.generateResponse(context);

        expect(result.type).toBe('tool_call');
        if (result.type === 'tool_call') {
            expect(result.tool.name).toBe('consultar_status');
            expect(result.usage).toEqual({
                inputTokens: 300,
                outputTokens: 60,
                totalTokens: 360,
            });
        }
    });
});
