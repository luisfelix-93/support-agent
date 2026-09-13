import type { HybridSearchResult } from "../Memory.js";

export interface RerankOptions {
    targetTags?: string[];
    targetTerms?: string[];
    topK?: number;
    decayFactor?: number;
    referenceDate?: Date;
}

export interface IMemoryReranker {
    /**
     * Reordena os candidatos da busca híbrida aplicando heurísticas contextuais e relevância temporal.
     */
    rerank(
        candidates: HybridSearchResult[],
        query: string,
        options?: RerankOptions
    ): Promise<HybridSearchResult[]>;
}
