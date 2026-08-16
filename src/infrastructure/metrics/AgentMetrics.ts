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
