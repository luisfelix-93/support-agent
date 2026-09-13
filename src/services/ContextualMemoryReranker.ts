import type { HybridSearchResult } from "../domain/Memory.js";
import type { IMemoryReranker, RerankOptions } from "../domain/ports/IMemoryReranker.js";
import { logger } from "../config/logger.js";

const log = logger.child({ module: 'ContextualMemoryReranker' });

/**
 * Reranker Contextual para Memória Operacional de Suporte
 * Combina RRF com matching de entidades técnicas (erros, serviços, pods),
 * bônus por tags e decaimento temporal para incidentes/resoluções.
 */
export class ContextualMemoryReranker implements IMemoryReranker {
    async rerank(
        candidates: HybridSearchResult[],
        query: string,
        options: RerankOptions = {}
    ): Promise<HybridSearchResult[]> {
        if (!candidates || candidates.length <= 1) {
            return candidates ?? [];
        }

        const topK = options.topK ?? candidates.length;
        const decayFactor = options.decayFactor ?? 0.02; // Meia-vida operacional ~35 dias
        const refDate = options.referenceDate ?? new Date();

        // Extrai termos técnicos e códigos de erro da query
        const extractedTerms = this.extractTechnicalTerms(query);
        const targetTags = new Set((options.targetTags ?? []).map(t => t.toLowerCase()));

        log.debug(
            { candidateCount: candidates.length, extractedTerms, targetTagsCount: targetTags.size },
            'Iniciando reranking contextual de memórias.'
        );

        const scoredCandidates = candidates.map(candidate => {
            let adjustedScore = candidate.score;
            const memory = candidate.memory;
            const contentLower = (memory.content || '').toLowerCase();
            const memoryTags = (memory.tags || []).map(t => t.toLowerCase());

            // 1. Bônus por correspondência exata de termos operacionais (códigos de erro, serviços)
            let termMatchBonus = 0;
            for (const term of extractedTerms) {
                const termLower = term.toLowerCase();
                if (contentLower.includes(termLower)) {
                    termMatchBonus += 0.35;
                }
                if (memoryTags.includes(termLower)) {
                    termMatchBonus += 0.5;
                }
            }

            // 2. Bônus por tags-alvo especificadas em options
            let tagBonus = 0;
            for (const tag of memoryTags) {
                if (targetTags.has(tag)) {
                    tagBonus += 0.4;
                }
            }

            // 3. Fator de Recência Temporal (para incidentes, resoluções e resumos)
            let recencyMultiplier = 1.0;
            const isTimeSensitive = memory.type === 'incident' || memory.type === 'resolution' || memory.type === 'summary';

            if (isTimeSensitive && memory.createdAt) {
                const ageDays = Math.max(0, (refDate.getTime() - new Date(memory.createdAt).getTime()) / (1000 * 60 * 60 * 24));
                recencyMultiplier = 1.0 / (1.0 + decayFactor * ageDays);
            }

            // 4. Cálculo final do score ajustado
            // O score base RRF é ponderado com os bônus e o fator de recência
            const matchMultiplier = 1.0 + Math.min(1.5, termMatchBonus + tagBonus);
            adjustedScore = adjustedScore * matchMultiplier * recencyMultiplier;

            return {
                ...candidate,
                score: adjustedScore,
            };
        });

        // Ordena decrescente pelo score ajustado
        scoredCandidates.sort((a, b) => b.score - a.score);

        return scoredCandidates.slice(0, topK);
    }

    /**
     * Extrai termos de alta relevância técnica:
     * - Códigos HTTP (ex: 500, 502, 503, 504, 404, 429)
     * - Erros estilo CONSTANTE (ex: ERR_CONNECTION_REFUSED, ECONNRESET, OOMKilled, CrashLoopBackOff)
     * - Identificadores com hífen ou underscore (ex: checkout-api, order-service, db_pool)
     */
    private extractTechnicalTerms(text: string): string[] {
        if (!text) return [];
        const terms = new Set<string>();

        // Regex para códigos de erro HTTP comuns
        const httpCodes = text.match(/\b[1-5]\d{2}\b/g);
        if (httpCodes) {
            httpCodes.forEach(code => terms.add(code));
        }

        // Regex para constantes de erro (ex: ERR_..., ECONNRESET, OOMKilled, CrashLoopBackOff)
        const errorTokens = text.match(/\b([A-Z][A-Za-z0-9]+(?:[A-Z][a-z0-9]+)+|[A-Z0-9_]{3,})\b/g);
        if (errorTokens) {
            errorTokens.forEach(token => {
                if (token.length > 2 && !/^(AND|THE|FOR|NOT|GET|POST|PUT|DEL)$/i.test(token)) {
                    terms.add(token);
                }
            });
        }

        // Regex para nomes de serviços/endpoints com hífen (ex: checkout-api, auth-v2)
        const slugTokens = text.match(/\b[a-z0-9]+(?:-[a-z0-9]+)+\b/gi);
        if (slugTokens) {
            slugTokens.forEach(token => terms.add(token));
        }

        return Array.from(terms);
    }
}
