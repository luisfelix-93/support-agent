import type { Request, Response } from 'express';
import type { IMemoryRepository } from '../domain/ports/IMemoryRepository.js';
import type { IMemoryReranker } from '../domain/ports/IMemoryReranker.js';
import type { IEmbeddingProvider } from '../domain/ports/IEmbeddingProvider.js';
import { MemoryLifecycle, type MemoryStatus, type MemoryType } from '../domain/Memory.js';
import { logger } from '../config/logger.js';

const log = logger.child({ module: 'MemoryController' });

export class MemoryController {
    constructor(
        private readonly memoryRepository: IMemoryRepository,
        private readonly memoryReranker?: IMemoryReranker,
        private readonly embeddingProvider?: IEmbeddingProvider
    ) {}

    /**
     * GET /api/memories
     * Lista memórias com filtros e paginação.
     */
    async list(req: Request, res: Response): Promise<void> {
        const user = req.user as any;
        const tenantId = (req.query.tenantId as string) || user?.tenantId;
        const workspaceId = req.query.workspaceId as string | undefined;
        const status = req.query.status as MemoryStatus | undefined;
        const type = req.query.type as MemoryType | undefined;
        const tag = req.query.tag as string | undefined;
        const limit = req.query.limit !== undefined ? Number(req.query.limit) : 20;
        const offset = req.query.offset !== undefined ? Number(req.query.offset) : 0;

        if (!tenantId || tenantId.trim() === '') {
            res.status(400).json({ error: 'O parâmetro tenantId é obrigatório.' });
            return;
        }

        try {
            const result = await this.memoryRepository.find({
                tenantId: tenantId.trim(),
                workspaceId: workspaceId?.trim(),
                status,
                type,
                tag: tag?.trim(),
                limit,
                offset,
            });

            res.status(200).json({
                success: true,
                data: {
                    total: result.total,
                    limit,
                    offset,
                    memories: result.memories,
                }
            });
        } catch (error) {
            log.error({ err: error, tenantId }, 'Erro ao listar memórias.');
            res.status(500).json({ error: 'Erro interno ao listar memórias.' });
        }
    }

    /**
     * POST /api/memories/search
     * Endpoint operacional para busca híbrida (vetorial + textual + RRF + Reranker).
     */
    async search(req: Request, res: Response): Promise<void> {
        const user = req.user as any;
        const { tenantId: bodyTenantId, workspaceId, query, limit, threshold, types, statuses, tags, rerank } = req.body ?? {};
        const tenantId = bodyTenantId || user?.tenantId;

        if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') {
            res.status(400).json({ error: 'O campo tenantId é obrigatório.' });
            return;
        }

        if (!workspaceId || typeof workspaceId !== 'string' || workspaceId.trim() === '') {
            res.status(400).json({ error: 'O campo workspaceId é obrigatório.' });
            return;
        }

        if (!query || typeof query !== 'string' || query.trim() === '') {
            res.status(400).json({ error: 'O campo query é obrigatório.' });
            return;
        }

        try {
            let vector: number[] | undefined;
            if (this.embeddingProvider) {
                try {
                    vector = await this.embeddingProvider.generateEmbedding(query.trim());
                } catch (embErr) {
                    log.warn({ err: embErr }, 'Falha ao gerar embedding para busca híbrida. Continuando com texto.');
                }
            }

            const searchLimit = limit !== undefined ? Number(limit) : 5;
            let results = await this.memoryRepository.searchHybrid({
                tenantId: tenantId.trim(),
                workspaceId: workspaceId.trim(),
                query: query.trim(),
                vector,
                limit: searchLimit,
                threshold: threshold !== undefined ? Number(threshold) : undefined,
                types,
                statuses,
                tags,
            });

            if (rerank !== false && this.memoryReranker) {
                results = await this.memoryReranker.rerank(results, query.trim(), {
                    topK: searchLimit,
                    targetTags: tags,
                });
            }

            res.status(200).json({
                success: true,
                count: results.length,
                data: results,
            });
        } catch (error) {
            log.error({ err: error, tenantId, query }, 'Erro ao executar busca híbrida de memórias.');
            res.status(500).json({ error: 'Erro interno ao buscar memórias.' });
        }
    }

    /**
     * GET /api/memories/candidates
     * Retorna a fila de memórias candidatas pendentes de curadoria ou validação humana.
     */
    async getCandidates(req: Request, res: Response): Promise<void> {
        const user = req.user as any;
        const tenantId = (req.query.tenantId as string) || user?.tenantId;
        const limit = req.query.limit !== undefined ? Number(req.query.limit) : 20;

        if (!tenantId || tenantId.trim() === '') {
            res.status(400).json({ error: 'O parâmetro tenantId é obrigatório.' });
            return;
        }

        try {
            const candidates = await this.memoryRepository.findCandidates(tenantId.trim(), limit);
            res.status(200).json({
                success: true,
                tenantId: tenantId.trim(),
                count: candidates.length,
                data: candidates,
            });
        } catch (error) {
            log.error({ err: error, tenantId }, 'Erro ao buscar memórias candidatas.');
            res.status(500).json({ error: 'Erro interno ao buscar memórias candidatas.' });
        }
    }

    /**
     * PATCH /api/memories/:id/status
     * Transiciona o status de ciclo de vida de uma memória com validação de máquina de estados.
     */
    async updateStatus(req: Request, res: Response): Promise<void> {
        const user = req.user as any;
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const { status, tenantId: bodyTenantId } = req.body ?? {};
        const tenantId = bodyTenantId || user?.tenantId;

        if (!id || id.trim() === '') {
            res.status(400).json({ error: 'O parâmetro id é obrigatório.' });
            return;
        }

        if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') {
            res.status(400).json({ error: 'O campo tenantId é obrigatório.' });
            return;
        }

        const validStatuses: MemoryStatus[] = ['candidate', 'validated', 'active', 'updated', 'expired'];
        if (!status || !validStatuses.includes(status)) {
            res.status(400).json({
                error: `Status inválido. Deve ser um dos seguintes: ${validStatuses.join(', ')}.`
            });
            return;
        }

        try {
            const memory = await this.memoryRepository.findById(id.trim(), tenantId.trim());
            if (!memory) {
                res.status(404).json({ error: 'Memória não encontrada para o id e tenant informados.' });
                return;
            }

            const currentStatus = memory.status || 'active';
            if (!MemoryLifecycle.canTransition(currentStatus, status)) {
                res.status(400).json({
                    error: `Transição de status inválida de '${currentStatus}' para '${status}'.`
                });
                return;
            }

            const validatedBy = user?.email || user?.userId || 'operator';
            await this.memoryRepository.updateStatus(id.trim(), tenantId.trim(), status, {
                validatedBy,
                previousStatus: currentStatus,
                transitionedAt: new Date().toISOString(),
            });

            res.status(200).json({
                success: true,
                id: id.trim(),
                status,
                validatedBy,
            });
        } catch (error) {
            log.error({ err: error, id, tenantId }, 'Erro ao atualizar status da memória.');
            res.status(500).json({ error: 'Erro interno ao atualizar status da memória.' });
        }
    }

    /**
     * PUT /api/memories/:id
     * Atualiza conteúdo, importância ou tags de uma memória existente.
     */
    async update(req: Request, res: Response): Promise<void> {
        const user = req.user as any;
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const { content, importance, tags, tenantId: bodyTenantId } = req.body ?? {};
        const tenantId = bodyTenantId || user?.tenantId;

        if (!id || id.trim() === '') {
            res.status(400).json({ error: 'O parâmetro id é obrigatório.' });
            return;
        }

        if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') {
            res.status(400).json({ error: 'O campo tenantId é obrigatório.' });
            return;
        }

        try {
            const existing = await this.memoryRepository.findById(id.trim(), tenantId.trim());
            if (!existing) {
                res.status(404).json({ error: 'Memória não encontrada.' });
                return;
            }

            const updatePayload: Record<string, unknown> = {};
            if (content !== undefined) updatePayload.content = String(content).trim();
            if (importance !== undefined) updatePayload.importance = Math.max(0.1, Math.min(1.0, Number(importance)));
            if (Array.isArray(tags)) updatePayload.tags = tags.map((t: string) => String(t).trim().toLowerCase());

            const updated = await this.memoryRepository.update(id.trim(), tenantId.trim(), updatePayload);

            res.status(200).json({
                success: true,
                data: updated,
            });
        } catch (error) {
            log.error({ err: error, id, tenantId }, 'Erro ao atualizar memória.');
            res.status(500).json({ error: 'Erro interno ao atualizar memória.' });
        }
    }

    /**
     * DELETE /api/memories/:id
     * Exclusão manual definitiva de uma memória (permissão de admin).
     */
    async delete(req: Request, res: Response): Promise<void> {
        const user = req.user as any;
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const tenantId = (req.query.tenantId as string) || (req.body?.tenantId as string) || user?.tenantId;

        if (!id || id.trim() === '') {
            res.status(400).json({ error: 'O parâmetro id é obrigatório.' });
            return;
        }

        if (!tenantId || tenantId.trim() === '') {
            res.status(400).json({ error: 'O parâmetro tenantId é obrigatório.' });
            return;
        }

        try {
            const deleted = await this.memoryRepository.delete(id.trim(), tenantId.trim());
            if (!deleted) {
                res.status(404).json({ error: 'Memória não encontrada para deleção.' });
                return;
            }

            res.status(200).json({
                success: true,
                id: id.trim(),
                message: 'Memória removida com sucesso.',
            });
        } catch (error) {
            log.error({ err: error, id, tenantId }, 'Erro ao remover memória.');
            res.status(500).json({ error: 'Erro interno ao deletar memória.' });
        }
    }
}
