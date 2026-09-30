import type { AgentRun } from "../domain/AgentRun.js";
import type {
    IAgentRunRepository,
    FindRunsOptions,
    TenantCostSummary,
    ToolAnalyticsSummary,
    LLMAnalyticsSummary
} from "../domain/ports/IAgentRunRepository.js";
import type { ISessionRepository } from "../domain/ports/ISessionRepository.js";
import { logger } from "../config/logger.js";

const log = logger.child({ module: 'RunAnalyticsService' });

export interface SessionAccountingSummary {
    sessionId: string;
    workspaceId: string;
    threadId: string;
    channelId?: string;
    status: string;
    startedAt: Date;
    lastInteractionAt: Date;
    closedAt?: Date | null;
    durationSeconds: number;
    turnCount: number;
    tokens: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        estimatedCostUsd: number;
    };
    runsCount: number;
}

export class RunAnalyticsService {
    constructor(
        private readonly agentRunRepository: IAgentRunRepository,
        private readonly sessionRepository?: ISessionRepository
    ) {}

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
     * Lista execuções do AgentRun associadas a uma sessão de investigação.
     */
    async listRunsBySession(sessionId: string): Promise<AgentRun[]> {
        if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
            return [];
        }

        try {
            return await this.agentRunRepository.findBySessionId(sessionId.trim());
        } catch (error) {
            log.error({ err: error, sessionId }, 'Erro ao listar AgentRuns por sessionId.');
            throw error;
        }
    }

    /**
     * Obtém resumo consolidado de contabilidade de tokens e custos para uma sessão de investigação.
     */
    async getSessionAccounting(sessionId: string): Promise<SessionAccountingSummary | null> {
        if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
            return null;
        }

        if (!this.sessionRepository) {
            log.warn({ sessionId }, 'Tentativa de obter contabilidade de sessão sem sessionRepository configurado.');
            throw new Error('ISessionRepository não configurado no RunAnalyticsService.');
        }

        const cleanSessionId = sessionId.trim();
        try {
            const session = await this.sessionRepository.findById(cleanSessionId);
            if (!session) {
                return null;
            }

            const runs = await this.agentRunRepository.findBySessionId(cleanSessionId);

            const endDate = session.closedAt ?? session.lastInteractionAt ?? new Date();
            const durationSeconds = Math.max(
                0,
                Math.round((endDate.getTime() - session.startedAt.getTime()) / 1000)
            );

            return {
                sessionId: session.id,
                workspaceId: session.workspaceId,
                threadId: session.threadId,
                channelId: session.channelId,
                status: session.status,
                startedAt: session.startedAt,
                lastInteractionAt: session.lastInteractionAt,
                closedAt: session.closedAt,
                durationSeconds,
                turnCount: session.turnCount,
                tokens: {
                    promptTokens: session.promptTokens,
                    completionTokens: session.completionTokens,
                    totalTokens: session.totalTokens,
                    estimatedCostUsd: session.estimatedCostUsd,
                },
                runsCount: runs.length,
            };
        } catch (error) {
            log.error({ err: error, sessionId: cleanSessionId }, 'Erro ao calcular contabilidade da sessão.');
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
