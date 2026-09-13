export interface RankedItem<T = string> {
    id: T;
    score?: number;
    importance?: number;
}

export interface RrfOptions {
    k?: number; // Constante de suavização (padrão: 60)
    vectorWeight?: number; // Peso do ranking vetorial (padrão: 1.0)
    textWeight?: number; // Peso do ranking textual (padrão: 1.2)
    importanceWeight?: number; // Peso da importância intrínseca (0.0 a 1.0, padrão: 0.3)
}

export interface FusedItem<T = string> {
    id: T;
    rrfScore: number;
    vectorRank?: number;
    textRank?: number;
    vectorScore?: number;
    textScore?: number;
    importance?: number;
}

/**
 * Algoritmo Reciprocal Rank Fusion (RRF)
 * Combina múltiplos rankings ordenados (vetorial e textual) em uma pontuação consolidada.
 * Fórmula: Score(d) = sum_{m in M} ( w_m / (k + rank_m(d)) )
 */
export function reciprocalRankFusion<T = string>(
    vectorResults: Array<RankedItem<T>>,
    textResults: Array<RankedItem<T>>,
    options: RrfOptions = {}
): Array<FusedItem<T>> {
    const k = options.k ?? 60;
    const vectorWeight = options.vectorWeight ?? 1.0;
    const textWeight = options.textWeight ?? 1.2;
    const importanceWeight = Math.max(0, Math.min(1, options.importanceWeight ?? 0.3));

    const itemMap = new Map<T, FusedItem<T>>();

    // 1. Processa ranking vetorial (1-indexed)
    vectorResults.forEach((item, index) => {
        const rank = index + 1;
        const current = itemMap.get(item.id) ?? {
            id: item.id,
            rrfScore: 0,
            importance: item.importance,
        };

        current.vectorRank = rank;
        current.vectorScore = item.score;
        if (item.importance !== undefined && current.importance === undefined) {
            current.importance = item.importance;
        }

        current.rrfScore += vectorWeight / (k + rank);
        itemMap.set(item.id, current);
    });

    // 2. Processa ranking textual (1-indexed)
    textResults.forEach((item, index) => {
        const rank = index + 1;
        const current = itemMap.get(item.id) ?? {
            id: item.id,
            rrfScore: 0,
            importance: item.importance,
        };

        current.textRank = rank;
        current.textScore = item.score;
        if (item.importance !== undefined && current.importance === undefined) {
            current.importance = item.importance;
        }

        current.rrfScore += textWeight / (k + rank);
        itemMap.set(item.id, current);
    });

    // 3. Aplica ponderação por importância intrínseca (se disponível)
    const fusedList = Array.from(itemMap.values()).map(item => {
        const imp = typeof item.importance === 'number' ? Math.max(0, Math.min(1, item.importance)) : 0.5;
        // Multiplicador entre (1 - importanceWeight) e 1.0
        const importanceMultiplier = (1 - importanceWeight) + (importanceWeight * imp);
        return {
            ...item,
            rrfScore: item.rrfScore * importanceMultiplier,
        };
    });

    // 4. Ordena por rrfScore decrescente com desempate determinístico
    fusedList.sort((a, b) => {
        if (b.rrfScore !== a.rrfScore) {
            return b.rrfScore - a.rrfScore;
        }
        // Desempate: quem apareceu em ambas as listas ganha
        const aBoth = a.vectorRank !== undefined && a.textRank !== undefined ? 1 : 0;
        const bBoth = b.vectorRank !== undefined && b.textRank !== undefined ? 1 : 0;
        if (bBoth !== aBoth) {
            return bBoth - aBoth;
        }
        // Desempate por melhor rank individual
        const aBestRank = Math.min(a.vectorRank ?? Infinity, a.textRank ?? Infinity);
        const bBestRank = Math.min(b.vectorRank ?? Infinity, b.textRank ?? Infinity);
        if (aBestRank !== bBestRank) {
            return aBestRank - bBestRank;
        }
        return String(a.id).localeCompare(String(b.id));
    });

    return fusedList;
}
