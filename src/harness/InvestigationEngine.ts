import type { PlaybookRegistry } from "../domain/workflows/PlaybookRegistry.js";
import type { ChatContext } from "../domain/ChatContext.js";
import { SessionSummary } from "../domain/workflows/SessionSummary.js";

export interface InvestigationPlan {
    playbookIds: string[];
    domains?: string[];
    systemInstructions: string;
    recommendedTools: string[];
    isIncident: boolean;
}

export class InvestigationEngine {
    constructor(private readonly registry: PlaybookRegistry) {}

    /**
     * Avalia a mensagem do usuário e contexto para determinar se playbooks investigativos devem ser ativados.
     * Retorna null se nenhuma diretriz especializada for necessária (modo conversacional comum).
     */
    evaluate(userMessage: string, context?: ChatContext): InvestigationPlan | null {
        if (!userMessage || userMessage.trim() === '') {
            return null;
        }

        const matchedPlaybooks = this.registry.findMatchingPlaybooks(userMessage, context);

        if (matchedPlaybooks.length === 0) {
            return null;
        }

        const playbookIds = matchedPlaybooks.map(p => p.id);
        const playbookPrompts = matchedPlaybooks.map(p => `### Playbook: ${p.name} (${p.id})\n${p.getInvestigationPrompt()}`).join('\n\n');
        
        const domainsSet = new Set<string>();
        for (const pb of matchedPlaybooks) {
            if (pb.domain) {
                domainsSet.add(pb.domain);
                if (pb.domain === 'kubernetes') {
                    domainsSet.add('k8s');
                    domainsSet.add('infra');
                } else if (pb.domain === 'api' || pb.domain === 'latency') {
                    domainsSet.add('observability');
                    domainsSet.add('metrics');
                    domainsSet.add('logs');
                    domainsSet.add('traces');
                } else if (pb.domain === 'database') {
                    domainsSet.add('db');
                    domainsSet.add('infra');
                }
            }
        }
        const domains = Array.from(domainsSet);

        const recommendedToolsSet = new Set<string>();
        for (const pb of matchedPlaybooks) {
            for (const tool of pb.getRecommendedTools()) {
                recommendedToolsSet.add(tool);
            }
        }
        const recommendedTools = Array.from(recommendedToolsSet);

        const systemInstructions = `[DIRETRIZ DE INVESTIGAÇÃO DE INCIDENTES SRE]
Você está atuando no modo de Investigação Especializada de Incidentes de TI.
Playbooks ativos nesta sessão: ${playbookIds.join(', ')}.

Siga rigorosamente este protocolo operacional:
1. TRIAGEM & IDENTIFICAÇÃO: Identifique o componente, serviço, endpoint ou namespace afetado a partir do relato.
2. HIPÓTESE & COLETA DE EVIDÊNCIAS: Execute chamadas de ferramentas disponíveis para verificar telemetria (logs, métricas, traces e estados).
3. CORRELAÇÃO CRUZADA: Correlacione erros de logs com taxas de requisição/falhas e métricas de saturação de recursos.
4. DELIMITAÇÃO TEMPORAL: Determine a janela de tempo estimada do incidente (quando começou).
5. AUTONOMIA READ-ONLY: Não tente executar ações de correção ou comandos destrutivos. Seu papel é investigar, encontrar a causa raiz e recomendar ações de mitigação.
6. RESUMO EXECUTIVO (SESSION SUMMARY): Ao concluir a análise técnica, termine obrigatoriamente a resposta com o bloco formatado abaixo:

═══════════════════════════════════════════════════════════
📋 RESUMO EXECUTIVO DE SESSÃO (SESSION SUMMARY)
═══════════════════════════════════════════════════════════
• Run ID: {runId}
• Serviço / Componente: {serviceName}
• Janela do Incidente: {janela ou horário}
• Playbooks Ativados: ${playbookIds.join(', ')}

🔍 EVIDÊNCIAS CONSOLIDADAS:
• Logs:
  - {logs e stack traces relevantes}
• Métricas:
  - {métricas observadas, percentis ou taxas de erro}

💡 HIPÓTESE DE CAUSA RAIZ (RCA):
{explicação técnica fundamentada do motivo da falha}

🛠️ AÇÕES RECOMENDADAS:
1. {ação de mitigação imediata}
2. {ação estrutural definitiva}
═══════════════════════════════════════════════════════════

---
DIRETRIZES ESPECÍFICAS DOS PLAYBOOKS ATIVOS:
${playbookPrompts}`;

        return {
            playbookIds,
            domains,
            systemInstructions,
            recommendedTools,
            isIncident: true,
        };
    }

    private readonly summaryHeaderPattern =
        '(?:(?:📋\\s*)?(?:##+\\s*)?RESUMO\\s+EXECUTIVO\\s+D[EA]\\s+SESS[AÃ]O(?:\\s*\\(SESSION\\s+SUMMARY\\))?|SESSION\\s+SUMMARY)';

    /**
     * Verifica se a resposta contém o bloco de Resumo Executivo (Session Summary) de forma tolerante a variações.
     */
    hasSessionSummary(responseText: string): boolean {
        if (!responseText) return false;
        return new RegExp(this.summaryHeaderPattern, 'i').test(responseText);
    }

    /**
     * Extrai um SessionSummary estruturado a partir da resposta final gerada pelo LLM.
     * Retorna null se a resposta não contiver o bloco de resumo executivo.
     */
    extractSessionSummary(responseText: string, runId: string, playbooksInvolved: string[] = []): SessionSummary | null {
        if (!responseText || !this.hasSessionSummary(responseText)) {
            return null;
        }

        try {
            const serviceMatch = responseText.match(/•\s*Serviço\s*\/\s*Componente:\s*(.+)/i);
            const serviceName = serviceMatch ? serviceMatch[1].trim() : 'Serviço Geral';

            const windowMatch = responseText.match(/•\s*Janela do Incidente:\s*(.+)/i);
            const windowText = windowMatch ? windowMatch[1].trim() : undefined;

            const rcaMatch = responseText.match(/💡\s*HIPÓTESE DE CAUSA RAIZ\s*\(RCA\):\s*([\s\S]*?)(?:🛠️|════|$)/i);
            const rootCauseHypothesis = rcaMatch ? rcaMatch[1].trim() : 'Causa raiz sob investigação.';

            const actionsMatch = responseText.match(/🛠️\s*AÇÕES RECOMENDADAS:\s*([\s\S]*?)(?:════|$)/i);
            const recommendedActions: string[] = [];
            if (actionsMatch) {
                const lines = actionsMatch[1].split('\n');
                for (const line of lines) {
                    const clean = line.replace(/^\s*\d+\.\s*|^[-*]\s*/, '').trim();
                    if (clean.length > 0) {
                        recommendedActions.push(clean);
                    }
                }
            }
            if (recommendedActions.length === 0) {
                recommendedActions.push('Monitorar telemetria e aplicar correções cabíveis.');
            }

            // Extração de evidências básicas de logs e métricas
            const logsMatch = responseText.match(/•\s*Logs:\s*([\s\S]*?)(?:•\s*Métricas:|💡|════|$)/i);
            const logsList: string[] = [];
            if (logsMatch) {
                const lines = logsMatch[1].split('\n');
                for (const line of lines) {
                    const clean = line.replace(/^\s*[-*]\s*/, '').trim();
                    if (clean.length > 0) logsList.push(clean);
                }
            }

            const metricsMatch = responseText.match(/•\s*Métricas:\s*([\s\S]*?)(?:•\s*Traces|💡|════|$)/i);
            const metricsList: string[] = [];
            if (metricsMatch) {
                const lines = metricsMatch[1].split('\n');
                for (const line of lines) {
                    const clean = line.replace(/^\s*[-*]\s*/, '').trim();
                    if (clean.length > 0) metricsList.push(clean);
                }
            }

            return new SessionSummary({
                runId,
                serviceName,
                incidentWindow: windowText ? { start: windowText } : undefined,
                rootCauseHypothesis,
                evidence: {
                    logs: logsList,
                    metrics: metricsList,
                },
                recommendedActions,
                playbooksInvolved,
            });
        } catch {
            return null;
        }
    }

    /**
     * Remove o bloco de Resumo Executivo (Session Summary) do texto da resposta,
     * preservando apenas a análise técnica e o diálogo da investigação.
     */
    stripSessionSummary(responseText: string): string {
        if (!responseText) return '';
        // 1. Remove bloco delimitado com separadores finais ═{5,}
        const withClosingSep = new RegExp(`(?:═{5,}\\s*)?${this.summaryHeaderPattern}(?:\\s*═{5,})?[\\s\\S]*?═{5,}`, 'gi');
        let cleaned = responseText.replace(withClosingSep, '');

        // 2. Remove o bloco do resumo até o final da string caso não haja separador de fechamento
        const toEnd = new RegExp(`(?:═{5,}\\s*)?${this.summaryHeaderPattern}[\\s\\S]*`, 'gi');
        cleaned = cleaned.replace(toEnd, '');

        // 3. Remove quaisquer linhas residuais de separadores
        cleaned = cleaned.replace(/═{5,}/g, '');
        return cleaned.trim();
    }
}
