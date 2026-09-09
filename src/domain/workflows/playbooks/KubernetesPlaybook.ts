import type { IInvestigationPlaybook, PlaybookDomain } from "../IInvestigationPlaybook.js";
import type { ChatContext } from "../../ChatContext.js";

export class KubernetesPlaybook implements IInvestigationPlaybook {
    public readonly id = 'kubernetes';
    public readonly name = 'Kubernetes & Infrastructure Playbook';
    public readonly domain: PlaybookDomain = 'kubernetes';
    public readonly description = 'Investigação especializada de pods em CrashLoopBackOff, OOMKilled, falhas de probes e eventos de cluster.';

    private readonly triggers: RegExp[] = [
        /\bk8s\b/i,
        /kubernetes/i,
        /\bpod\b/i,
        /\bpods\b/i,
        /crashloop/i,
        /crashloopbackoff/i,
        /\boom\b/i,
        /oomkilled/i,
        /deployment.*quebr/i,
        /pod.*reinici/i,
        /reinicio.*pod/i,
        /container.*caiu/i,
        /cluster.*evento/i,
        /liveness.*probe/i,
        /readiness.*probe/i,
        /imagepullbackoff/i,
    ];

    matches(userMessage: string, context?: ChatContext): boolean {
        if (!userMessage) return false;

        if (this.triggers.some(regex => regex.test(userMessage))) {
            return true;
        }

        if (context && context.messages && context.messages.length > 0) {
            const recent = context.messages.slice(-3);
            return recent.some(m => m.role === 'user' && this.triggers.some(regex => regex.test(m.content)));
        }

        return false;
    }

    getInvestigationPrompt(): string {
        return `[DIRETRIZES DO PLAYBOOK: KUBERNETES & INFRASTRUCTURE]
- OBJETIVO: Diagnosticar falhas em containers, pods reiniciando, contenção de recursos e anomalias de cluster.
- PASSOS DE INVESTIGAÇÃO:
  1. Identifique o namespace, nome do deployment ou prefixo do pod relatado.
  2. Execute ferramentas de status de pod (ex: get_pod_status, k8s_get_pod_status) para verificar status, fase e contagem de restarts.
  3. Execute ferramentas de logs (ex: get_pod_logs, k8s_get_pod_logs) com previous=true para capturar a causa da queda do container antes do reinício.
  4. Inspecione eventos do cluster (ex: get_cluster_events, k8s_get_events) em busca de OOMKilled (Exit Code 137), falhas de Liveness/Readiness probe ou falhas de agendamento (Node Pressure).
  5. Avalie se o consumo real excedeu o resources.limits.memory ou limits.cpu.
  6. Formule a hipótese de causa raiz e gere ações recomendadas de infraestrutura (aumento de limites, correção de probe ou leak de memória), sintetizando no Resumo Executivo da Sessão.`;
    }

    getRecommendedTools(): string[] {
        return [
            'get_pod_status',
            'k8s_get_pod_status',
            'get_pod_logs',
            'k8s_get_pod_logs',
            'get_cluster_events',
            'k8s_get_events',
        ];
    }
}
