import { describe, it, expect } from 'vitest';
import { ContextualMemoryReranker } from './ContextualMemoryReranker.js';
import type { HybridSearchResult } from '../domain/Memory.js';

describe('ContextualMemoryReranker', () => {
    const reranker = new ContextualMemoryReranker();

    it('deve priorizar memórias contendo código de erro técnico exato correspondente à query', async () => {
        const candidates: HybridSearchResult[] = [
            {
                memory: {
                    id: 'mem-generic',
                    tenantId: 'tenant-1',
                    workspaceId: 'ws-1',
                    type: 'incident',
                    status: 'active',
                    content: 'Instabilidade e lentidão geral nas APIs de checkout',
                    importance: 0.9,
                    tags: ['general'],
                    createdAt: new Date('2026-09-10T10:00:00Z'),
                    updatedAt: new Date('2026-09-10T10:00:00Z'),
                },
                score: 0.85,
            },
            {
                memory: {
                    id: 'mem-exact-code',
                    tenantId: 'tenant-1',
                    workspaceId: 'ws-1',
                    type: 'incident',
                    status: 'active',
                    content: 'Falhas de gateway com erro 504 Gateway Timeout no checkout-api',
                    importance: 0.85,
                    tags: ['checkout-api', '504'],
                    createdAt: new Date('2026-09-10T10:00:00Z'),
                    updatedAt: new Date('2026-09-10T10:00:00Z'),
                },
                score: 0.75, // score RRF base era menor
            }
        ];

        const query = 'Estamos investigando o erro 504 no checkout-api';
        const reranked = await reranker.rerank(candidates, query, { referenceDate: new Date('2026-09-10T12:00:00Z') });

        // mem-exact-code deve ultrapassar mem-generic devido ao bônus de termos operacionais (504 e checkout-api)
        expect(reranked[0].memory.id).toBe('mem-exact-code');
        expect(reranked[0].score).toBeGreaterThan(reranked[1].score);
    });

    it('deve aplicar decaimento temporal para incidentes antigos vs incidentes recentes', async () => {
        const refDate = new Date('2026-09-13T10:00:00Z');

        const candidates: HybridSearchResult[] = [
            {
                memory: {
                    id: 'mem-old-incident',
                    tenantId: 'tenant-1',
                    workspaceId: 'ws-1',
                    type: 'incident',
                    status: 'active',
                    content: 'Queda de conexão no banco de dados HikariCP',
                    importance: 0.9,
                    tags: ['hikaricp'],
                    createdAt: new Date('2026-06-01T10:00:00Z'), // ~104 dias atrás
                    updatedAt: new Date('2026-06-01T10:00:00Z'),
                },
                score: 0.80,
            },
            {
                memory: {
                    id: 'mem-recent-incident',
                    tenantId: 'tenant-1',
                    workspaceId: 'ws-1',
                    type: 'incident',
                    status: 'active',
                    content: 'Queda de conexão no banco de dados HikariCP',
                    importance: 0.9,
                    tags: ['hikaricp'],
                    createdAt: new Date('2026-09-12T10:00:00Z'), // 1 dia atrás
                    updatedAt: new Date('2026-09-12T10:00:00Z'),
                },
                score: 0.78,
            }
        ];

        const query = 'Conexão saturada no HikariCP';
        const reranked = await reranker.rerank(candidates, query, { referenceDate: refDate });

        // O incidente recente deve superar o incidente de 104 dias atrás
        expect(reranked[0].memory.id).toBe('mem-recent-incident');
    });

    it('não deve penalizar fatos permanentes com decaimento temporal', async () => {
        const refDate = new Date('2026-09-13T10:00:00Z');

        const candidates: HybridSearchResult[] = [
            {
                memory: {
                    id: 'mem-fact-old',
                    tenantId: 'tenant-1',
                    workspaceId: 'ws-1',
                    type: 'fact',
                    status: 'active',
                    content: 'O banco de produção é PostgreSQL 15 com replica read-only',
                    importance: 0.9,
                    createdAt: new Date('2025-01-01T10:00:00Z'), // Mais de 1 ano atrás
                    updatedAt: new Date('2025-01-01T10:00:00Z'),
                },
                score: 0.90,
            }
        ];

        const query = 'Qual é o banco de produção?';
        const reranked = await reranker.rerank(candidates, query, { referenceDate: refDate });

        // Score não deve sofrer recencyMultiplier de decaimento
        expect(reranked[0].score).toBeGreaterThanOrEqual(0.90);
    });

    it('deve respeitar a opção topK limitando a lista resultante', async () => {
        const candidates: HybridSearchResult[] = [
            {
                memory: { id: 'm1', tenantId: 't', workspaceId: 'w', type: 'fact', status: 'active', content: 'Doc 1', importance: 0.8, createdAt: new Date(), updatedAt: new Date() },
                score: 0.8,
            },
            {
                memory: { id: 'm2', tenantId: 't', workspaceId: 'w', type: 'fact', status: 'active', content: 'Doc 2', importance: 0.7, createdAt: new Date(), updatedAt: new Date() },
                score: 0.7,
            },
            {
                memory: { id: 'm3', tenantId: 't', workspaceId: 'w', type: 'fact', status: 'active', content: 'Doc 3', importance: 0.6, createdAt: new Date(), updatedAt: new Date() },
                score: 0.6,
            }
        ];

        const reranked = await reranker.rerank(candidates, 'Doc', { topK: 2 });
        expect(reranked).toHaveLength(2);
    });
});
