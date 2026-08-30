import OpenAI from "openai";
import type { IEmbeddingProvider } from "../../domain/ports/IEmbeddingProvider.js";
import { logger } from "../../config/logger.js";
import { withSpan } from "../tracing/TracerProvider.js";
import { agentEmbeddingDurationSeconds } from "../metrics/AgentMetrics.js";

const log = logger.child({ module: 'OpenAIEmbeddingProvider' });

export class OpenAIEmbeddingProvider implements IEmbeddingProvider {
    private readonly client: OpenAI;
    private readonly model: string;

    constructor(
        apiKey: string,
        model: string = 'text-embedding-3-small',
        baseUrl?: string
    ) {
        this.client = new OpenAI({
            apiKey,
            baseURL: baseUrl,
        });
        this.model = model;
    }

    async generateEmbedding(text: string): Promise<number[]> {
        const results = await this.generateEmbeddings([text]);
        if (!results[0] || results[0].length === 0) {
            throw new Error('Nenhum vetor de embedding retornado para o texto fornecido.');
        }
        return results[0];
    }

    async generateEmbeddings(texts: string[]): Promise<number[][]> {
        if (!texts || texts.length === 0) {
            return [];
        }

        const cleanedTexts = texts.map(t => t.trim()).filter(t => t.length > 0);
        if (cleanedTexts.length === 0) {
            return [];
        }

        return withSpan(
            'embedding.generate',
            {
                attributes: {
                    'embedding.model': this.model,
                    'embedding.batch_size': cleanedTexts.length,
                },
            },
            async (span) => {
                const startTime = Date.now();
                try {
                    const response = await this.client.embeddings.create({
                        model: this.model,
                        input: cleanedTexts,
                    });

                    const durationSeconds = (Date.now() - startTime) / 1000;
                    agentEmbeddingDurationSeconds.observe(
                        { provider: 'openai', model: this.model },
                        durationSeconds
                    );

                    const embeddings = response.data.map(item => item.embedding);
                    span.setAttribute('embedding.dimensions', embeddings[0]?.length || 0);

                    log.debug(
                        { count: embeddings.length, model: this.model, durationMs: Date.now() - startTime },
                        'Embeddings gerados com sucesso.'
                    );

                    return embeddings;
                } catch (error) {
                    log.error({ err: error, model: this.model }, 'Erro ao gerar embeddings via OpenAI.');
                    throw error;
                }
            }
        );
    }
}
