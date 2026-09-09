export interface LogEvidence {
    timestamp?: string;
    level?: string;
    message: string;
    source?: string;
}

export interface MetricEvidence {
    query: string;
    value: number | string;
    unit?: string;
    timestamp?: string;
    description?: string;
}

export interface TraceEvidence {
    traceId: string;
    spanId?: string;
    operationName: string;
    durationMs: number;
    error?: boolean;
    serviceName?: string;
}

export interface InfrastructureEvidence {
    component: string;
    status: string;
    details?: string;
    restartCount?: number;
}

export interface DatabaseEvidence {
    metricOrQuery: string;
    value?: string | number;
    poolUtilization?: number;
    slowQuery?: boolean;
}

export class EvidenceLedger {
    private readonly logs: LogEvidence[] = [];
    private readonly metrics: MetricEvidence[] = [];
    private readonly traces: TraceEvidence[] = [];
    private readonly infrastructure: InfrastructureEvidence[] = [];
    private readonly database: DatabaseEvidence[] = [];

    addLog(log: LogEvidence): void {
        this.logs.push(log);
    }

    addMetric(metric: MetricEvidence): void {
        this.metrics.push(metric);
    }

    addTrace(trace: TraceEvidence): void {
        this.traces.push(trace);
    }

    addInfrastructure(infra: InfrastructureEvidence): void {
        this.infrastructure.push(infra);
    }

    addDatabase(db: DatabaseEvidence): void {
        this.database.push(db);
    }

    getLogs(): readonly LogEvidence[] {
        return [...this.logs];
    }

    getMetrics(): readonly MetricEvidence[] {
        return [...this.metrics];
    }

    getTraces(): readonly TraceEvidence[] {
        return [...this.traces];
    }

    getInfrastructure(): readonly InfrastructureEvidence[] {
        return [...this.infrastructure];
    }

    getDatabase(): readonly DatabaseEvidence[] {
        return [...this.database];
    }

    hasEvidence(): boolean {
        return (
            this.logs.length > 0 ||
            this.metrics.length > 0 ||
            this.traces.length > 0 ||
            this.infrastructure.length > 0 ||
            this.database.length > 0
        );
    }

    clear(): void {
        this.logs.length = 0;
        this.metrics.length = 0;
        this.traces.length = 0;
        this.infrastructure.length = 0;
        this.database.length = 0;
    }

    exportSummary(): string {
        if (!this.hasEvidence()) {
            return "Nenhuma evidência técnica registrada até o momento.";
        }

        const sections: string[] = [];

        if (this.logs.length > 0) {
            const logsText = this.logs
                .map(l => `- [${l.level?.toUpperCase() || 'LOG'}] ${l.message}${l.source ? ` (${l.source})` : ''}`)
                .join('\n');
            sections.push(`### Logs Relevantes:\n${logsText}`);
        }

        if (this.metrics.length > 0) {
            const metricsText = this.metrics
                .map(m => `- ${m.description || m.query}: ${m.value}${m.unit ? ` ${m.unit}` : ''}`)
                .join('\n');
            sections.push(`### Métricas Observadas:\n${metricsText}`);
        }

        if (this.traces.length > 0) {
            const tracesText = this.traces
                .map(t => `- [Trace ${t.traceId}] ${t.operationName} (${t.serviceName || 'desconhecido'}) durou ${t.durationMs}ms${t.error ? ' [ERRO]' : ''}`)
                .join('\n');
            sections.push(`### Traces & Gargalos:\n${tracesText}`);
        }

        if (this.infrastructure.length > 0) {
            const infraText = this.infrastructure
                .map(i => `- [Infra: ${i.component}] Status: ${i.status}${i.restartCount !== undefined ? ` (Restarts: ${i.restartCount})` : ''}${i.details ? ` - ${i.details}` : ''}`)
                .join('\n');
            sections.push(`### Infraestrutura & Kubernetes:\n${infraText}`);
        }

        if (this.database.length > 0) {
            const dbText = this.database
                .map(d => `- [Banco] ${d.metricOrQuery}: ${d.value ?? 'N/A'}${d.poolUtilization !== undefined ? ` (Uso pool: ${(d.poolUtilization * 100).toFixed(1)}%)` : ''}${d.slowQuery ? ' [SLOW QUERY]' : ''}`)
                .join('\n');
            sections.push(`### Banco de Dados & Conexões:\n${dbText}`);
        }

        return sections.join('\n\n');
    }
}
