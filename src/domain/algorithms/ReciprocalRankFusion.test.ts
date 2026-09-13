import { describe, it, expect } from 'vitest';
import { reciprocalRankFusion } from './ReciprocalRankFusion.js';

describe('ReciprocalRankFusion', () => {
    it('deve priorizar itens presentes em ambos os rankings (vetorial e textual)', () => {
        const vectorResults = [
            { id: 'doc-A', score: 0.95 },
            { id: 'doc-B', score: 0.85 },
            { id: 'doc-C', score: 0.75 },
        ];

        const textResults = [
            { id: 'doc-B', score: 12.5 },
            { id: 'doc-D', score: 10.0 },
            { id: 'doc-A', score: 8.0 },
        ];

        const fused = reciprocalRankFusion(vectorResults, textResults, { k: 60 });

        // doc-B e doc-A aparecem em ambos, portanto devem ter scores maiores que doc-C ou doc-D
        expect(fused[0].id).toBe('doc-B'); // Rank 2 vetorial + Rank 1 textual
        expect(fused[1].id).toBe('doc-A'); // Rank 1 vetorial + Rank 3 textual
        expect(fused[0].vectorRank).toBe(2);
        expect(fused[0].textRank).toBe(1);
        expect(fused[1].vectorRank).toBe(1);
        expect(fused[1].textRank).toBe(3);

        const singleHits = fused.slice(2).map(item => item.id);
        expect(singleHits).toContain('doc-C');
        expect(singleHits).toContain('doc-D');
    });

    it('deve aplicar pesos customizados para rankings vetorial e textual', () => {
        const vectorResults = [{ id: 'doc-vec', score: 0.9 }];
        const textResults = [{ id: 'doc-txt', score: 10 }];

        // Com textWeight maior (1.5 vs 1.0), rank 1 textual deve superar rank 1 vetorial
        const fused = reciprocalRankFusion(vectorResults, textResults, {
            k: 60,
            vectorWeight: 1.0,
            textWeight: 1.5,
            importanceWeight: 0,
        });

        expect(fused[0].id).toBe('doc-txt');
        expect(fused[1].id).toBe('doc-vec');
        expect(fused[0].rrfScore).toBeGreaterThan(fused[1].rrfScore);
    });

    it('deve levar em consideracao o parametro importance quando fornecido', () => {
        const vectorResults = [
            { id: 'doc-normal', score: 0.9, importance: 0.2 },
            { id: 'doc-important', score: 0.88, importance: 1.0 },
        ];

        const textResults: Array<{ id: string; score: number }> = [];

        const fused = reciprocalRankFusion(vectorResults, textResults, {
            k: 60,
            importanceWeight: 0.5,
        });

        // doc-important tem rank 2, mas importância 1.0 vs 0.2
        expect(fused[0].id).toBe('doc-important');
        expect(fused[1].id).toBe('doc-normal');
    });

    it('deve lidar corretamente com listas vazias', () => {
        expect(reciprocalRankFusion([], [])).toEqual([]);

        const onlyVector = reciprocalRankFusion([{ id: 'doc-1', score: 0.9 }], []);
        expect(onlyVector).toHaveLength(1);
        expect(onlyVector[0].id).toBe('doc-1');
        expect(onlyVector[0].vectorRank).toBe(1);
        expect(onlyVector[0].textRank).toBeUndefined();

        const onlyText = reciprocalRankFusion([], [{ id: 'doc-2', score: 5.0 }]);
        expect(onlyText).toHaveLength(1);
        expect(onlyText[0].id).toBe('doc-2');
        expect(onlyText[0].textRank).toBe(1);
        expect(onlyText[0].vectorRank).toBeUndefined();
    });

    it('deve resolver empates com estabilidade determinística', () => {
        const vectorResults = [
            { id: 'doc-B', score: 0.9 },
            { id: 'doc-A', score: 0.9 },
        ];
        const textResults: Array<{ id: string; score: number }> = [];

        const fused = reciprocalRankFusion(vectorResults, textResults, { k: 60 });
        expect(fused).toHaveLength(2);
        // doc-B é rank 1 vetorial, doc-A é rank 2 vetorial
        expect(fused[0].id).toBe('doc-B');
        expect(fused[1].id).toBe('doc-A');
    });
});
