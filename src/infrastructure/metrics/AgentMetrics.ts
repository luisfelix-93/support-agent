import client from 'prom-client';
import { metricsRegister } from '../../config/metrics.js';

export const agentRunsTotal = new client.Counter({
    name: 'agent_runs_total',
    help: 'Total de execuções do Agent Harness por tenant e status.',
    labelNames: ['tenantId', 'status'],
    registers: [metricsRegister],
});

export const agentRunsFailedTotal = new client.Counter({
    name: 'agent_runs_failed_total',
    help: 'Total de falhas na execução do Agent Harness.',
    labelNames: ['tenantId', 'reason'],
    registers: [metricsRegister],
});

export const agentRunDurationSeconds = new client.Histogram({
    name: 'agent_run_duration_seconds',
    help: 'Duração das execuções do Agent Harness em segundos.',
    labelNames: ['tenantId', 'status'],
    buckets: [0.1, 0.5, 1, 2.5, 5, 10, 25, 60],
    registers: [metricsRegister],
});

export const agentToolCallsTotal = new client.Counter({
    name: 'agent_tool_calls_total',
    help: 'Total de ferramentas chamadas pelo Agent Harness.',
    labelNames: ['tenantId', 'tool'],
    registers: [metricsRegister],
});

export const agentMemorySearchDurationSeconds = new client.Histogram({
    name: 'agent_memory_search_duration_seconds',
    help: 'Duração da busca de memórias relevantes em segundos.',
    labelNames: ['tenantId', 'searchType'],
    buckets: [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [metricsRegister],
});

export const agentMemoryPromotedTotal = new client.Counter({
    name: 'agent_memory_promoted_total',
    help: 'Total de memórias promovidas para longo prazo por tenant e tipo.',
    labelNames: ['tenantId', 'type'],
    registers: [metricsRegister],
});

export const agentEmbeddingDurationSeconds = new client.Histogram({
    name: 'agent_embedding_duration_seconds',
    help: 'Duração da geração de embeddings em segundos.',
    labelNames: ['provider', 'model'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [metricsRegister],
});

export const agentSessionsTotal = new client.Counter({
    name: 'agent_sessions_total',
    help: 'Total de sessões de investigação criadas por workspace.',
    labelNames: ['workspaceId'],
    registers: [metricsRegister],
});

export const agentSessionsClosedTotal = new client.Counter({
    name: 'agent_sessions_closed_total',
    help: 'Total de sessões de investigação encerradas por motivo.',
    labelNames: ['workspaceId', 'reason'],
    registers: [metricsRegister],
});

export const agentSessionDurationSeconds = new client.Histogram({
    name: 'agent_session_duration_seconds',
    help: 'Duração total da sessão de investigação em segundos.',
    labelNames: ['workspaceId', 'reason'],
    buckets: [60, 300, 900, 1800, 3600, 7200, 14400],
    registers: [metricsRegister],
});

export const agentSessionTokensTotal = new client.Counter({
    name: 'agent_session_tokens_total',
    help: 'Total de tokens consumidos em sessões de investigação por workspace, status e tipo de token.',
    labelNames: ['workspaceId', 'status', 'tokenType'],
    registers: [metricsRegister],
});

export const agentSessionCostUsdTotal = new client.Counter({
    name: 'agent_session_cost_usd_total',
    help: 'Custo total estimado em USD de sessões de investigação por workspace e status.',
    labelNames: ['workspaceId', 'status'],
    registers: [metricsRegister],
});

export interface SessionMetricsInput {
    workspaceId: string;
    status: string;
    closedAt?: Date | null;
    startedAt: Date;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
}

export function recordSessionClosureMetrics(session: SessionMetricsInput, reason: 'user' | 'timeout'): void {
    agentSessionsClosedTotal.inc({ workspaceId: session.workspaceId, reason });
    if (session.closedAt) {
        const durationSec = Math.max(0, (session.closedAt.getTime() - session.startedAt.getTime()) / 1000);
        agentSessionDurationSeconds.observe({ workspaceId: session.workspaceId, reason }, durationSec);
    }
    if (session.promptTokens > 0) {
        agentSessionTokensTotal.inc({ workspaceId: session.workspaceId, status: session.status, tokenType: 'prompt' }, session.promptTokens);
    }
    if (session.completionTokens > 0) {
        agentSessionTokensTotal.inc({ workspaceId: session.workspaceId, status: session.status, tokenType: 'completion' }, session.completionTokens);
    }
    if (session.totalTokens > 0) {
        agentSessionTokensTotal.inc({ workspaceId: session.workspaceId, status: session.status, tokenType: 'total' }, session.totalTokens);
    }
    if (session.estimatedCostUsd > 0) {
        agentSessionCostUsdTotal.inc({ workspaceId: session.workspaceId, status: session.status }, session.estimatedCostUsd);
    }
}

