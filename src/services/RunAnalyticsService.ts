import type { AgentRun } from "../domain/AgentRun.js";
import type {
    IAgentRunRepository,
    FindRunsOptions,
    TenantCostSummary,
    ToolAnalyticsSummary,
    LLMAnalyticsSummary
} from "../domain/ports/IAgentRunRepository.js";
import { logger } from "../config/logger.js";

const log = logger.child({ module: 'RunAnalyticsService' });

export class RunAnalyticsService {
    constructor(private readonly agentRunRepository: IAgentRunRepository) {}

    /**
     * Busca os dados completos de uma execução pelo runId.
     */
    async getRunById(runId: string): Promise<AgentRun | null> {
        if (!runId || typeof runId !== 'string' || runId.trim() === '') {
            return null;
        }

        try {
            return await this.agentRunRepository.findByRunId(runId.trim());
        } catch (error) {
            log.error({ err: error, runId }, 'Erro ao buscar AgentRun por runId.');
            throw error;
        }
    }

    /**
     * Lista execuções de um tenant com filtros e paginação segura.
     */
    async listRuns(tenantId: string, options?: FindRunsOptions): Promise<AgentRun[]> {
        if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') {
            throw new Error('O parâmetro tenantId é obrigatório.');
        }

        const limit = options?.limit !== undefined
            ? Math.min(100, Math.max(1, Number(options.limit) || 50))
            : 50;
        const offset = options?.offset !== undefined
            ? Math.max(0, Number(options.offset) || 0)
            : 0;

        const { from, to } = this.validateAndNormalizeDates(options?.from, options?.to);

        const normalizedOptions: FindRunsOptions = {
            limit,
            offset,
            status: options?.status,
            from,
            to,
        };

        try {
            return await this.agentRunRepository.findByTenant(tenantId.trim(), normalizedOptions);
        } catch (error) {
            log.error({ err: error, tenantId, options: normalizedOptions }, 'Erro ao listar AgentRuns por tenant.');
            throw error;
        }
    }

    /**
     * Obtém resumo analítico de custos e tokens agrupados por tenant.
     */
    async getCostAnalytics(tenantId?: string, from?: Date, to?: Date): Promise<TenantCostSummary[]> {
        const { from: validFrom, to: validTo } = this.validateAndNormalizeDates(from, to);
        const cleanTenantId = tenantId && tenantId.trim() !== '' ? tenantId.trim() : undefined;

        try {
            return await this.agentRunRepository.aggregateCostByTenant(cleanTenantId, validFrom, validTo);
        } catch (error) {
            log.error({ err: error, tenantId: cleanTenantId }, 'Erro ao calcular agregação de custos por tenant.');
            throw error;
        }
    }

    /**
     * Obtém métricas de desempenho e taxas de sucesso das ferramentas/MCPs.
     */
    async getToolAnalytics(tenantId?: string, from?: Date, to?: Date): Promise<ToolAnalyticsSummary[]> {
        const { from: validFrom, to: validTo } = this.validateAndNormalizeDates(from, to);
        const cleanTenantId = tenantId && tenantId.trim() !== '' ? tenantId.trim() : undefined;

        try {
            return await this.agentRunRepository.aggregateToolAnalytics(cleanTenantId, validFrom, validTo);
        } catch (error) {
            log.error({ err: error, tenantId: cleanTenantId }, 'Erro ao calcular analytics de ferramentas.');
            throw error;
        }
    }

    /**
     * Obtém métricas consolidadas de consumo e custo por modelo LLM.
     */
    async getLLMAnalytics(tenantId?: string, from?: Date, to?: Date): Promise<LLMAnalyticsSummary[]> {
        const { from: validFrom, to: validTo } = this.validateAndNormalizeDates(from, to);
        const cleanTenantId = tenantId && tenantId.trim() !== '' ? tenantId.trim() : undefined;

        try {
            return await this.agentRunRepository.aggregateLLMAnalytics(cleanTenantId, validFrom, validTo);
        } catch (error) {
            log.error({ err: error, tenantId: cleanTenantId }, 'Erro ao calcular analytics de LLMs.');
            throw error;
        }
    }

    /**
     * Valida e normaliza o intervalo de datas.
     */
    private validateAndNormalizeDates(from?: Date, to?: Date): { from?: Date; to?: Date } {
        const validFrom = from instanceof Date && !isNaN(from.getTime()) ? from : undefined;
        const validTo = to instanceof Date && !isNaN(to.getTime()) ? to : undefined;

        if (validFrom && validTo && validFrom > validTo) {
            throw new Error('A data inicial (from) não pode ser posterior à data final (to).');
        }

        return { from: validFrom, to: validTo };
    }
}
