import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIEmbeddingProvider } from './OpenAIEmbeddingProvider.js';
import OpenAI from 'openai';

const mockCreate = vi.fn();
vi.mock('openai', () => {
    return {
        default: vi.fn().mockImplementation(function () {
            return {
                embeddings: {
                    create: mockCreate,
                },
            };
        }),
    };
});

describe('OpenAIEmbeddingProvider', () => {
    let provider: OpenAIEmbeddingProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        provider = new OpenAIEmbeddingProvider('fake-openai-api-key', 'text-embedding-3-small');
    });

    it('deve gerar embedding único corretamente', async () => {
        const fakeVector = [0.1, 0.2, 0.3];
        mockCreate.mockResolvedValue({
            data: [{ embedding: fakeVector }],
        });

        const result = await provider.generateEmbedding('Texto para vetorizar');

        expect(mockCreate).toHaveBeenCalledWith({
            model: 'text-embedding-3-small',
            input: ['Texto para vetorizar'],
        });
        expect(result).toEqual(fakeVector);
    });

    it('deve gerar embeddings em lote (batch)', async () => {
        const fakeVectors = [
            [0.1, 0.2, 0.3],
            [0.4, 0.5, 0.6]
        ];

        mockCreate.mockResolvedValue({
            data: [
                { embedding: fakeVectors[0] },
                { embedding: fakeVectors[1] },
            ],
        });

        const result = await provider.generateEmbeddings(['Texto 1', 'Texto 2']);

        expect(mockCreate).toHaveBeenCalledWith({
            model: 'text-embedding-3-small',
            input: ['Texto 1', 'Texto 2'],
        });
        expect(result).toEqual(fakeVectors);
    });

    it('deve retornar array vazio se textos forem vazios', async () => {
        const result = await provider.generateEmbeddings([]);
        expect(result).toEqual([]);
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('deve lançar erro se a API OpenAI falhar', async () => {
        mockCreate.mockRejectedValue(new Error('OpenAI Rate Limit Exceeded'));

        await expect(provider.generateEmbedding('Texto')).rejects.toThrow('OpenAI Rate Limit Exceeded');
    });
});
