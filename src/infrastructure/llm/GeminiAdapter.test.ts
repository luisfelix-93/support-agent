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

    it('deve passar as ferramentas dinâmicas para a chamada da API do Gemini', async () => {
        mockGenerateContent.mockResolvedValueOnce({
            candidates: [
                {
                    content: {
                        parts: [{ text: 'Usando ferramenta.' }],
                    },
                },
            ],
        });

        const context = new ChatContext('thread-2.5', 'workspace-1', [
            new Message('msg-1', 'user', 'Listar ferramentas'),
        ]);

        const tools = [
            {
                name: 'custom_mcp_tool',
                description: 'Uma ferramenta customizada',
                inputSchema: {
                    type: 'object',
                    properties: {
                        param1: { type: 'string' }
                    },
                    required: ['param1']
                }
            }
        ];

        await adapter.generateResponse(context, tools);

        const callArgs = mockGenerateContent.mock.calls[0][0];
        expect(callArgs.config.tools).toHaveLength(1);
        expect(callArgs.config.tools[0].functionDeclarations).toHaveLength(1);
        expect(callArgs.config.tools[0].functionDeclarations[0]).toEqual({
            name: 'custom_mcp_tool',
            description: 'Uma ferramenta customizada',
            parameters: {
                type: 'object',
                properties: {
                    param1: { type: 'string' }
                },
                required: ['param1']
            }
        });
    });

    it('deve filtrar mensagens de sistema e enviá-las como systemInstruction', async () => {
        mockGenerateContent.mockResolvedValueOnce({
            candidates: [
                {
                    content: {
                        parts: [{ text: 'Entendido.' }],
                    },
                },
            ],
        });

        const context = new ChatContext('thread-3', 'workspace-1', [
            new Message('msg-1', 'system', 'Você é um agente de suporte.'),
            new Message('msg-2', 'user', 'Preciso de ajuda.'),
        ]);

        await adapter.generateResponse(context);

        const callArgs = mockGenerateContent.mock.calls[0][0];

        // A mensagem de sistema não deve aparecer em contents
        expect(callArgs.contents).toHaveLength(1);
        expect(callArgs.contents[0].role).toBe('user');

        // A instrução de sistema deve estar em config.systemInstruction
        expect(callArgs.config.systemInstruction).toBe('Você é um agente de suporte.');
    });

    it('deve mapear role "assistant" para "model" no formato Gemini', async () => {
        mockGenerateContent.mockResolvedValueOnce({
            candidates: [
                {
                    content: {
                        parts: [{ text: 'Ok.' }],
                    },
                },
            ],
        });

        const context = new ChatContext('thread-4', 'workspace-1', [
            new Message('msg-1', 'user', 'Você lembra da última resposta?'),
            new Message('msg-2', 'assistant', 'Sim, lembro.'),
            new Message('msg-3', 'user', 'Ótimo!'),
        ]);

        await adapter.generateResponse(context);

        const callArgs = mockGenerateContent.mock.calls[0][0];
        expect(callArgs.contents[1].role).toBe('model');
    });

    it('deve retornar texto vazio se a resposta não tiver partes de texto', async () => {
        mockGenerateContent.mockResolvedValueOnce({
            candidates: [
                {
                    content: {
                        parts: [],
                    },
                },
            ],
        });

        const context = new ChatContext('thread-5', 'workspace-1', [
            new Message('msg-1', 'user', 'Teste'),
        ]);

        const result = await adapter.generateResponse(context);

        expect(result).toEqual({ type: 'text', content: '' });
    });

    it('deve propagar erro se a API do Gemini lançar uma exceção', async () => {
        mockGenerateContent.mockRejectedValueOnce(new Error('API key inválida'));

        const context = new ChatContext('thread-6', 'workspace-1', [
            new Message('msg-1', 'user', 'Olá'),
        ]);

        await expect(adapter.generateResponse(context)).rejects.toThrow('API key inválida');
    });
});
