import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMMemoryExtractor } from './LLMMemoryExtractor.js';
import { Message } from '../../domain/Message.js';
import type { ILLMProvider } from '../../domain/ports/ILLMProvider.js';

describe('LLMMemoryExtractor', () => {
    let extractor: LLMMemoryExtractor;
    let mockLLMProvider: ILLMProvider;

    beforeEach(() => {
        extractor = new LLMMemoryExtractor();
        mockLLMProvider = {
            generateResponse: vi.fn(),
        };
    });

    it('deve extrair memórias quando o LLM retornar JSON válido', async () => {
        const jsonResponse = JSON.stringify([
            {
                type: 'fact',
                content: 'O servidor de banco de dados é PostgreSQL 15.',
                importance: 0.9,
            },
            {
                type: 'preference',
                content: 'O usuário prefere explicações passo a passo.',
                importance: 0.8,
            }
        ]);

        vi.mocked(mockLLMProvider.generateResponse).mockResolvedValue({
            type: 'text',
            content: jsonResponse,
        });

        const messages = [
            new Message('1', 'user', 'Estamos usando o PostgreSQL 15 e prefiro que você me explique passo a passo as coisas.'),
            new Message('2', 'assistant', 'Perfeito! Vou explicar passo a passo a partir de agora.')
        ];

        const memories = await extractor.extract({
            tenantId: 'tenant-1',
            workspaceId: 'ws-1',
            threadId: 'thread-1',
            messages,
            llmProvider: mockLLMProvider,
        });

        expect(memories).toHaveLength(2);
        expect(memories[0].tenantId).toBe('tenant-1');
        expect(memories[0].workspaceId).toBe('ws-1');
        expect(memories[0].type).toBe('fact');
        expect(memories[0].content).toBe('O servidor de banco de dados é PostgreSQL 15.');
        expect(memories[0].importance).toBe(0.9);

        expect(memories[1].type).toBe('preference');
        expect(memories[1].content).toBe('O usuário prefere explicações passo a passo.');
        expect(memories[1].importance).toBe(0.8);
    });

    it('deve limpar markdown code block ```json ``` antes de parsear', async () => {
        const rawContent = `\`\`\`json
[
  {
    "type": "incident",
    "content": "Falha de conexão no Redis devido a timeout.",
    "importance": 0.85
  }
]
\`\`\``;

        vi.mocked(mockLLMProvider.generateResponse).mockResolvedValue({
            type: 'text',
            content: rawContent,
        });

        const messages = [
            new Message('1', 'user', 'O Redis caiu por timeout ontem à noite.')
        ];

        const memories = await extractor.extract({
            tenantId: 'tenant-1',
            workspaceId: 'ws-1',
            threadId: 'thread-1',
            messages,
            llmProvider: mockLLMProvider,
        });

        expect(memories).toHaveLength(1);
        expect(memories[0].type).toBe('incident');
        expect(memories[0].content).toBe('Falha de conexão no Redis devido a timeout.');
        expect(memories[0].importance).toBe(0.85);
    });

    it('deve retornar array vazio se não houver mensagens', async () => {
        const memories = await extractor.extract({
            tenantId: 'tenant-1',
            workspaceId: 'ws-1',
            threadId: 'thread-1',
            messages: [],
            llmProvider: mockLLMProvider,
        });

        expect(memories).toEqual([]);
        expect(mockLLMProvider.generateResponse).not.toHaveBeenCalled();
    });

    it('deve retornar array vazio graciosamente se o LLM responder texto não-JSON', async () => {
        vi.mocked(mockLLMProvider.generateResponse).mockResolvedValue({
            type: 'text',
            content: 'Desculpe, não encontrei nenhuma memória.',
        });

        const messages = [new Message('1', 'user', 'Oi!')];

        const memories = await extractor.extract({
            tenantId: 'tenant-1',
            workspaceId: 'ws-1',
            threadId: 'thread-1',
            messages,
            llmProvider: mockLLMProvider,
        });

        expect(memories).toEqual([]);
    });

    it('deve retornar array vazio se a resposta do LLM for uma tool_call', async () => {
        vi.mocked(mockLLMProvider.generateResponse).mockResolvedValue({
            type: 'tool_call',
            tool: { id: 'call_1', name: 'some_tool', parameters: {} },
        });

        const messages = [new Message('1', 'user', 'Oi!')];

        const memories = await extractor.extract({
            tenantId: 'tenant-1',
            workspaceId: 'ws-1',
            threadId: 'thread-1',
            messages,
            llmProvider: mockLLMProvider,
        });

        expect(memories).toEqual([]);
    });
});
