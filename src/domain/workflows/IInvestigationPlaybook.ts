import type { ChatContext } from "../ChatContext.js";

export type PlaybookDomain = 'api' | 'latency' | 'kubernetes' | 'database' | 'general' | string;

export interface IInvestigationPlaybook {
    readonly id: string;
    readonly name: string;
    readonly domain: PlaybookDomain;
    readonly description: string;

    /**
     * Avalia se a mensagem do usuário e/ou contexto ativam este playbook.
     */
    matches(userMessage: string, context?: ChatContext): boolean;

    /**
     * Retorna o prompt de sistema especializado com as diretrizes investigativas do playbook.
     */
    getInvestigationPrompt(): string;

    /**
     * Retorna a lista de ferramentas recomendadas para execução deste playbook.
     */
    getRecommendedTools(): string[];
}
