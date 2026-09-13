import type { IMCPClient } from "./ports/IMCPClient.js";

/**
 * Representa a configuração e o registro de um servidor MCP individual
 * dentro de uma plataforma ou cliente composto Multi-MCP.
 */
export interface MCPServerRegistration {
    /**
     * Identificador único (slug) do servidor MCP.
     * Exemplo: 'k8s', 'observability', 'database', 'jira'
     */
    readonly id: string;

    /**
     * Nome descritivo e amigável do servidor.
     * Exemplo: 'Kubernetes Cluster MCP', 'Observability (Loki & Prometheus)'
     */
    readonly name: string;

    /**
     * Instância do cliente MCP para este servidor.
     */
    readonly client: IMCPClient;

    /**
     * Domínios operacionais aos quais as ferramentas deste servidor pertencem.
     * Usado para Tool Discovery contextual por playbooks/sintomas.
     * Exemplo: ['kubernetes', 'infra'], ['observability', 'metrics', 'logs'], ['database']
     */
    readonly domains?: string[];

    /**
     * Indica se este é o servidor default para fallback quando ferramentas
     * são chamadas sem prefixo de namespace.
     */
    readonly isDefault?: boolean;

    /**
     * Timeout específico para este servidor (opcional).
     */
    readonly timeoutMs?: number;

    /**
     * Metadados adicionais do servidor (versão, endpoint, tags, etc.).
     */
    readonly metadata?: Record<string, unknown>;
}
