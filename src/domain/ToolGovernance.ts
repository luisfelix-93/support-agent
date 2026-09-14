import type { ToolCall } from "./ToolCall.js";

/**
 * Níveis de classificação de risco para ferramentas externas MCP.
 */
export type ToolRiskLevel = 'READ_ONLY' | 'LOW_RISK' | 'HIGH_RISK' | 'FORBIDDEN';

export const ToolRiskLevel = {
    READ_ONLY: 'READ_ONLY' as const,
    LOW_RISK: 'LOW_RISK' as const,
    HIGH_RISK: 'HIGH_RISK' as const,
    FORBIDDEN: 'FORBIDDEN' as const,
};

/**
 * Regra customizada de classificação de ferramentas.
 */
export interface ToolRule {
    readonly pattern: string | RegExp;
    readonly riskLevel: ToolRiskLevel;
    readonly description?: string;
}

/**
 * Política de governança de ferramentas aplicável por tenant ou globalmente.
 */
export interface ToolGovernancePolicy {
    /**
     * Se true, permite execução de ferramentas HIGH_RISK sem exigir aprovação humana.
     * Default: false (ações de alto risco são suspensas/bloqueadas em modo autônomo).
     */
    readonly allowHighRiskWithoutApproval?: boolean;

    /**
     * Lista de padrões (regex ou strings) de ferramentas terminantemente bloqueadas.
     */
    readonly blockedToolPatterns?: string[];

    /**
     * Regras customizadas com precedência sobre as regras padrão do sistema.
     */
    readonly customRules?: ToolRule[];

    /**
     * Lista de níveis de risco permitidos para execução.
     */
    readonly allowedRiskLevels?: ToolRiskLevel[];
}

/**
 * Decisão do avaliador de governança de ferramentas.
 */
export interface ToolGovernanceDecision {
    readonly allowed: boolean;
    readonly riskLevel: ToolRiskLevel;
    readonly reason?: string;
    readonly requiresApproval?: boolean;
}
