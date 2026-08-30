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
