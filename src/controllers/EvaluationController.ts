import type { Request, Response } from 'express';
import type { IEvaluationRepository } from '../domain/ports/IEvaluationRepository.js';
import type { AggregationService } from '../evaluation/AggregationService.js';
import { logger } from '../config/logger.js';

const log = logger.child({ module: 'EvaluationController' });

export class EvaluationController {
    constructor(
        private readonly evaluationRepository: IEvaluationRepository,
        private readonly aggregationService: AggregationService
    ) {}

    /**
     * GET /api/evaluations/:runId
     * Retorna o resultado da avaliação de uma execução específica.
     */
    async getByRunId(req: Request, res: Response): Promise<void> {
        const runId = Array.isArray(req.params.runId) ? req.params.runId[0] : req.params.runId;

        if (!runId) {
            res.status(400).json({ error: 'O parâmetro runId é obrigatório.' });
            return;
        }

        try {
            const result = await this.evaluationRepository.findByRunId(runId);
            if (!result) {
                res.status(404).json({ error: 'Avaliação não encontrada para o runId informado.' });
                return;
            }

            res.status(200).json({ success: true, data: result });
        } catch (error) {
            log.error({ err: error, runId }, 'Erro ao buscar avaliação por runId.');
            res.status(500).json({ error: 'Erro interno ao buscar avaliação.' });
        }
    }

    /**
     * GET /api/evaluations?tenantId=X&limit=20&skip=0&agentVersion=1.0.0
     * Lista avaliações paginadas filtradas por tenant, data e versão.
     */
    async listByTenant(req: Request, res: Response): Promise<void> {
        const { tenantId, limit, skip, from, to, agentVersion } = req.query;

        if (!tenantId || typeof tenantId !== 'string') {
            res.status(400).json({ error: 'O query parameter tenantId é obrigatório.' });
            return;
        }

        try {
            const parsedLimit = limit ? Math.min(100, Math.max(1, Number(limit))) : 20;
            const parsedSkip = skip ? Math.max(0, Number(skip)) : 0;
            const fromDate = from ? new Date(String(from)) : undefined;
            const toDate = to ? new Date(String(to)) : undefined;
            const versionStr = agentVersion ? String(agentVersion) : undefined;

            const results = await this.evaluationRepository.findByTenant(tenantId, {
                limit: parsedLimit,
                skip: parsedSkip,
                from: fromDate,
                to: toDate,
                agentVersion: versionStr,
            });

            res.status(200).json({
                success: true,
                count: results.length,
                limit: parsedLimit,
                skip: parsedSkip,
                data: results,
            });
        } catch (error) {
            log.error({ err: error, tenantId }, 'Erro ao listar avaliações por tenant.');
            res.status(500).json({ error: 'Erro interno ao listar avaliações.' });
        }
    }

    /**
     * GET /api/evaluations/stats/:version
     * Retorna estatísticas consolidadas agregadas de uma versão específica do agente.
     */
    async getVersionStats(req: Request, res: Response): Promise<void> {
        const version = Array.isArray(req.params.version) ? req.params.version[0] : req.params.version;

        if (!version) {
            res.status(400).json({ error: 'O parâmetro version é obrigatório.' });
            return;
        }

        try {
            const stats = await this.aggregationService.getVersionStats(version);
            res.status(200).json({ success: true, data: stats });
        } catch (error) {
            log.error({ err: error, version }, 'Erro ao obter estatísticas da versão.');
            res.status(500).json({ error: 'Erro interno ao obter estatísticas da versão.' });
        }
    }

    /**
     * GET /api/evaluations/compare?versionA=1.0.0&versionB=1.1.0&threshold=0.10
     * Compara o desempenho de duas versões do agente.
     */
    async compareVersions(req: Request, res: Response): Promise<void> {
        const { versionA, versionB, threshold } = req.query;

        if (!versionA || !versionB || typeof versionA !== 'string' || typeof versionB !== 'string') {
            res.status(400).json({ error: 'Os query parameters versionA e versionB são obrigatórios.' });
            return;
        }

        try {
            const parsedThreshold = threshold ? Number(threshold) : 0.10;
            const comparison = await this.aggregationService.compareVersions(versionA, versionB, parsedThreshold);
            res.status(200).json({ success: true, data: comparison });
        } catch (error) {
            log.error({ err: error, versionA, versionB }, 'Erro ao comparar versões do agente.');
            res.status(500).json({ error: 'Erro interno ao comparar versões.' });
        }
    }

    /**
     * GET /api/evaluations/regression?currentVersion=2.0.0&previousVersion=1.9.0&threshold=0.10
     * Avalia se houve regressão de qualidade, custo ou risco entre versões.
     */
    async detectRegression(req: Request, res: Response): Promise<void> {
        const { currentVersion, previousVersion, threshold } = req.query;

        if (!currentVersion || !previousVersion || typeof currentVersion !== 'string' || typeof previousVersion !== 'string') {
            res.status(400).json({ error: 'Os query parameters currentVersion e previousVersion são obrigatórios.' });
            return;
        }

        try {
            const parsedThreshold = threshold ? Number(threshold) : 0.10;
            const report = await this.aggregationService.detectRegression(currentVersion, previousVersion, parsedThreshold);
            res.status(200).json({ success: true, data: report });
        } catch (error) {
            log.error({ err: error, currentVersion, previousVersion }, 'Erro ao analisar regressão de versão.');
            res.status(500).json({ error: 'Erro interno ao detectar regressão.' });
        }
    }

    /**
     * GET /api/evaluations/summary/:tenantId?from=2026-09-01&to=2026-09-07
     * Retorna resumo analítico consolidado do tenant no período.
     */
    async getTenantSummary(req: Request, res: Response): Promise<void> {
        const tenantId = Array.isArray(req.params.tenantId) ? req.params.tenantId[0] : req.params.tenantId;
        const { from, to } = req.query;

        if (!tenantId) {
            res.status(400).json({ error: 'O parâmetro tenantId é obrigatório.' });
            return;
        }

        try {
            const now = new Date();
            const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 dias atrás
            const fromDate = from ? new Date(String(from)) : defaultFrom;
            const toDate = to ? new Date(String(to)) : now;

            const summary = await this.aggregationService.getTenantSummary(tenantId, fromDate, toDate);
            res.status(200).json({ success: true, data: summary });
        } catch (error) {
            log.error({ err: error, tenantId }, 'Erro ao gerar resumo de avaliações do tenant.');
            res.status(500).json({ error: 'Erro interno ao gerar resumo do tenant.' });
        }
    }
}
