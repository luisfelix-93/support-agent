export interface IncidentWindow {
    start?: string;
    end?: string;
}

export interface SummaryEvidence {
    logs: string[];
    metrics: string[];
    traces?: string[];
    infra?: string[];
    database?: string[];
}

export interface SessionSummaryProps {
    runId: string;
    serviceName: string;
    incidentWindow?: IncidentWindow;
    rootCauseHypothesis: string;
    evidence: SummaryEvidence;
    recommendedActions: string[];
    playbooksInvolved?: string[];
}

export class SessionSummary {
    public readonly runId: string;
    public readonly serviceName: string;
    public readonly incidentWindow?: IncidentWindow;
    public readonly rootCauseHypothesis: string;
    public readonly evidence: SummaryEvidence;
    public readonly recommendedActions: string[];
    public readonly playbooksInvolved: string[];

    constructor(props: SessionSummaryProps) {
        if (!props.runId || props.runId.trim() === '') {
            throw new Error('O campo runId é obrigatório para o SessionSummary.');
        }
        if (!props.rootCauseHypothesis || props.rootCauseHypothesis.trim() === '') {
            throw new Error('A hipótese de causa raiz (rootCauseHypothesis) é obrigatória.');
        }
        if (!props.recommendedActions || props.recommendedActions.length === 0) {
            throw new Error('O SessionSummary deve conter ao menos uma ação recomendada.');
        }

        this.runId = props.runId;
        this.serviceName = props.serviceName?.trim() || 'Serviço Geral';
        this.incidentWindow = props.incidentWindow;
        this.rootCauseHypothesis = props.rootCauseHypothesis.trim();
        this.evidence = {
            logs: props.evidence.logs || [],
            metrics: props.evidence.metrics || [],
            traces: props.evidence.traces || [],
            infra: props.evidence.infra || [],
            database: props.evidence.database || [],
        };
        this.recommendedActions = [...props.recommendedActions];
        this.playbooksInvolved = props.playbooksInvolved ? [...props.playbooksInvolved] : [];
    }

    static createFallback(session: any, reason: 'user' | 'timeout' = 'user'): SessionSummary {
        const ledger = session.evidenceLedger;
        const hasEvidences = ledger && typeof ledger.hasEvidence === 'function' ? ledger.hasEvidence() : false;

        const hypothesis = reason === 'timeout'
            ? (hasEvidences
                ? 'Sessão encerrada por inatividade. Resumo compilado a partir das evidências coletadas durante a sessão.'
                : 'Sessão encerrada automaticamente após atingir o tempo limite de inatividade sem novas mensagens.')
            : (hasEvidences
                ? 'Sessão encerrada pelo operador. Resumo compilado a partir das evidências coletadas durante a sessão.'
                : 'Sessão de investigação encerrada pelo operador.');

        const defaultActions = reason === 'timeout'
            ? [
                'Verificar telemetria recente do serviço para confirmar estabilização.',
                'Reabrir a investigação enviando uma nova mensagem caso anomalias persistam.',
              ]
            : [
                'Monitorar os serviços e aplicar correções cabíveis conforme o diagnóstico.',
                'Caso surjam novos incidentes, inicie uma nova análise enviando mensagem na thread.',
              ];

        const startIso = session.startedAt instanceof Date
            ? session.startedAt.toISOString()
            : new Date(session.startedAt || Date.now()).toISOString();
        const endIso = session.lastInteractionAt instanceof Date
            ? session.lastInteractionAt.toISOString()
            : new Date(session.lastInteractionAt || Date.now()).toISOString();

        if (hasEvidences) {
            return new SessionSummary({
                runId: session.id,
                serviceName: (session.metadata?.serviceName as string) || 'Serviço sob Investigação',
                incidentWindow: {
                    start: startIso,
                    end: endIso,
                },
                rootCauseHypothesis: hypothesis,
                evidence: {
                    logs: ledger.getLogs().map((l: any) => l.message),
                    metrics: ledger.getMetrics().map((m: any) => `${m.query}: ${m.value}${m.unit ? ` ${m.unit}` : ''}`),
                    traces: ledger.getTraces().map((t: any) => `${t.operationName} (${t.durationMs}ms)`),
                    infra: ledger.getInfrastructure().map((i: any) => `${i.component}: ${i.status}`),
                    database: ledger.getDatabase().map((d: any) => `${d.metricOrQuery}: ${d.value}`),
                },
                recommendedActions: defaultActions,
            });
        }

        return new SessionSummary({
            runId: session.id,
            serviceName: (session.metadata?.serviceName as string) || 'Investigação Geral',
            incidentWindow: {
                start: startIso,
                end: endIso,
            },
            rootCauseHypothesis: hypothesis,
            evidence: { logs: [], metrics: [] },
            recommendedActions: defaultActions,
        });
    }

    toMarkdown(): string {
        const windowText = this.incidentWindow?.start
            ? `${this.incidentWindow.start} até ${this.incidentWindow.end || 'Em andamento'}`
            : 'Janela de tempo não especificada';

        const playbooksText = this.playbooksInvolved.length > 0
            ? this.playbooksInvolved.join(', ')
            : 'Investigação Geral';

        const logsFormatted = this.evidence.logs.length > 0
            ? this.evidence.logs.map(l => `  - ${l}`).join('\n')
            : '  - Nenhum log crítico reportado';

        const metricsFormatted = this.evidence.metrics.length > 0
            ? this.evidence.metrics.map(m => `  - ${m}`).join('\n')
            : '  - Nenhuma anomalia de métrica reportada';

        let extraEvidences = '';
        if (this.evidence.traces && this.evidence.traces.length > 0) {
            extraEvidences += `\n• Traces / Gargalos:\n${this.evidence.traces.map(t => `  - ${t}`).join('\n')}`;
        }
        if (this.evidence.infra && this.evidence.infra.length > 0) {
            extraEvidences += `\n• Infraestrutura / Kubernetes:\n${this.evidence.infra.map(i => `  - ${i}`).join('\n')}`;
        }
        if (this.evidence.database && this.evidence.database.length > 0) {
            extraEvidences += `\n• Banco de Dados:\n${this.evidence.database.map(d => `  - ${d}`).join('\n')}`;
        }

        const actionsFormatted = this.recommendedActions
            .map((action, idx) => `${idx + 1}. ${action}`)
            .join('\n');

        return `═══════════════════════════════════════════════════════════
📋 RESUMO EXECUTIVO DE SESSÃO (SESSION SUMMARY)
═══════════════════════════════════════════════════════════
• Run ID: ${this.runId}
• Serviço / Componente: ${this.serviceName}
• Janela do Incidente: ${windowText}
• Playbooks Ativados: ${playbooksText}

🔍 EVIDÊNCIAS CONSOLIDADAS:
• Logs:
${logsFormatted}
• Métricas:
${metricsFormatted}${extraEvidences}

💡 HIPÓTESE DE CAUSA RAIZ (RCA):
${this.rootCauseHypothesis}

🛠️ AÇÕES RECOMENDADAS:
${actionsFormatted}
═══════════════════════════════════════════════════════════`;
    }
}
