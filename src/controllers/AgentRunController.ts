import type { Request, Response } from 'express';
import type { RunAnalyticsService } from '../services/RunAnalyticsService.js';
import type { AgentRunStatus } from '../domain/AgentRun.js';
import { logger } from '../config/logger.js';

const log = logger.child({ module: 'AgentRunController' });

export class AgentRunController {
    constructor(private readonly runAnalyticsService: RunAnalyticsService) {}

    /**
     * GET /api/runs/:runId
     * Retorna detalhes completos de uma execução pelo runId.
     */
    async getById(req: Request, res: Response): Promise<void> {
        const runId = Array.isArray(req.params.runId) ? req.params.runId[0] : req.params.runId;

        if (!runId || runId.trim() === '') {
            res.status(400).json({ error: 'O parâmetro runId é obrigatório.' });
            return;
        }

        try {
            const run = await this.runAnalyticsService.getRunById(runId.trim());
            if (!run) {
                res.status(404).json({ error: 'Execução não encontrada para o runId informado.' });
                return;
            }

            res.status(200).json({ success: true, data: run });
        } catch (error) {
            log.error({ err: error, runId }, 'Erro ao buscar execução por runId.');
            res.status(500).json({ error: 'Erro interno ao buscar execução.' });
        }
    }

    /**
     * GET /api/runs?tenantId=X&status=completed&from=...&to=...&limit=20&offset=0
     * Lista execuções paginadas filtradas por tenant.
     */
    async list(req: Request, res: Response): Promise<void> {
        const { tenantId, status, from, to, limit, offset } = req.query;

        if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') {
            res.status(400).json({ error: 'O query parameter tenantId é obrigatório.' });
            return;
        }

        try {
            const parsedLimit = limit !== undefined ? Number(limit) : undefined;
            const parsedOffset = offset !== undefined ? Number(offset) : undefined;
            const parsedFrom = from ? new Date(String(from)) : undefined;
            const parsedTo = to ? new Date(String(to)) : undefined;
            const parsedStatus = status ? (String(status) as AgentRunStatus) : undefined;

            const runs = await this.runAnalyticsService.listRuns(tenantId, {
                limit: parsedLimit,
                offset: parsedOffset,
                status: parsedStatus,
                from: parsedFrom,
                to: parsedTo,
            });

            res.status(200).json({
                success: true,
                data: runs,
                count: runs.length,
            });
        } catch (error: any) {
            log.error({ err: error, tenantId }, 'Erro ao listar execuções por tenant.');
            if (error?.message?.includes('posterior')) {
                res.status(400).json({ error: error.message });
                return;
            }
            res.status(500).json({ error: 'Erro interno ao listar execuções.' });
        }
    }

    /**
     * GET /api/runs/analytics/cost?tenantId=X&from=...&to=...
     * Retorna agregação financeira e de tokens por tenant.
     */
    async getCostAnalytics(req: Request, res: Response): Promise<void> {
        const { tenantId, from, to } = req.query;

        try {
            const parsedTenantId = typeof tenantId === 'string' ? tenantId : undefined;
            const parsedFrom = from ? new Date(String(from)) : undefined;
            const parsedTo = to ? new Date(String(to)) : undefined;

            const data = await this.runAnalyticsService.getCostAnalytics(parsedTenantId, parsedFrom, parsedTo);

            res.status(200).json({ success: true, data });
        } catch (error: any) {
            log.error({ err: error, tenantId }, 'Erro ao buscar métricas de custo.');
            if (error?.message?.includes('posterior')) {
                res.status(400).json({ error: error.message });
                return;
            }
            res.status(500).json({ error: 'Erro interno ao buscar métricas de custo.' });
        }
    }

    /**
     * GET /api/runs/analytics/tools?tenantId=X&from=...&to=...
     * Retorna métricas de taxa de sucesso e tempo de resposta das ferramentas.
     */
    async getToolAnalytics(req: Request, res: Response): Promise<void> {
        const { tenantId, from, to } = req.query;

        try {
            const parsedTenantId = typeof tenantId === 'string' ? tenantId : undefined;
            const parsedFrom = from ? new Date(String(from)) : undefined;
            const parsedTo = to ? new Date(String(to)) : undefined;

            const data = await this.runAnalyticsService.getToolAnalytics(parsedTenantId, parsedFrom, parsedTo);

            res.status(200).json({ success: true, data });
        } catch (error: any) {
            log.error({ err: error, tenantId }, 'Erro ao buscar analytics de ferramentas.');
            if (error?.message?.includes('posterior')) {
                res.status(400).json({ error: error.message });
                return;
            }
            res.status(500).json({ error: 'Erro interno ao buscar analytics de ferramentas.' });
        }
    }

    /**
     * GET /api/runs/analytics/llm?tenantId=X&from=...&to=...
     * Retorna métricas agregadas de consumo e latência por modelo LLM.
     */
    async getLLMAnalytics(req: Request, res: Response): Promise<void> {
        const { tenantId, from, to } = req.query;

        try {
            const parsedTenantId = typeof tenantId === 'string' ? tenantId : undefined;
            const parsedFrom = from ? new Date(String(from)) : undefined;
            const parsedTo = to ? new Date(String(to)) : undefined;

            const data = await this.runAnalyticsService.getLLMAnalytics(parsedTenantId, parsedFrom, parsedTo);

            res.status(200).json({ success: true, data });
        } catch (error: any) {
            log.error({ err: error, tenantId }, 'Erro ao buscar analytics de LLMs.');
            if (error?.message?.includes('posterior')) {
                res.status(400).json({ error: error.message });
                return;
            }
            res.status(500).json({ error: 'Erro interno ao buscar analytics de LLMs.' });
        }
    }
}
