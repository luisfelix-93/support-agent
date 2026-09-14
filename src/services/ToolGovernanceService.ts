import type { ToolCall } from "../domain/ToolCall.js";
import {
    type ToolRiskLevel,
    type ToolGovernancePolicy,
    type ToolGovernanceDecision,
} from "../domain/ToolGovernance.js";
import { logger } from "../config/logger.js";

const log = logger.child({ module: 'ToolGovernanceService' });

/**
 * Padrões regex padrão para categorização automática de risco baseada em nomes de ferramentas.
 */
const FORBIDDEN_PATTERN = /(^|__)(delete|drop|truncate|kill|purge|destroy|wipe|terminate|rmdir|unlink|format|erase)(_|$)/i;
const HIGH_RISK_PATTERN = /(^|__)(restart|scale|reboot|shutdown|patch|exec|flush|evict|cordon|drain|apply|deploy|rollback|write|insert)(_|$)/i;
const LOW_RISK_PATTERN = /(^|__)(set|update|modify|change|config|trigger|enable|disable|tag|annotate)(_|$)/i;
const READ_ONLY_PATTERN = /(^|__)(get|list|describe|query|fetch|read|check|status|inspect|search|find|view|show|explain|ping|metrics|logs|events)(_|$)/i;

/**
 * Serviço de Governança de Ferramentas (Tool Governance).
 * Avalia riscos e intercepta a execução de ferramentas de múltiplos servidores MCP.
 */
export class ToolGovernanceService {
    /**
     * Classifica o nível de risco de uma ferramenta considerando o nome e as políticas ativas.
     */
    classify(toolName: string, policy?: ToolGovernancePolicy): ToolRiskLevel {
        if (!toolName || typeof toolName !== 'string') {
            return 'FORBIDDEN';
        }

        const normalizedName = toolName.trim();
        const baseName = normalizedName.includes('__')
            ? normalizedName.substring(normalizedName.indexOf('__') + 2)
            : normalizedName;

        // 1. Verifica se há bloqueio explícito por padrões no tenant
        if (policy?.blockedToolPatterns && policy.blockedToolPatterns.length > 0) {
            for (const pattern of policy.blockedToolPatterns) {
                if (this.matchPattern(normalizedName, pattern) || this.matchPattern(baseName, pattern)) {
                    return 'FORBIDDEN';
                }
            }
        }

        // 2. Verifica regras customizadas do tenant (com precedência)
        if (policy?.customRules && policy.customRules.length > 0) {
            for (const rule of policy.customRules) {
                if (this.matchPattern(normalizedName, rule.pattern) || this.matchPattern(baseName, rule.pattern)) {
                    return rule.riskLevel;
                }
            }
        }

        // 3. Regras padrão do sistema baseadas em convenção de nomes de verbos
        if (FORBIDDEN_PATTERN.test(normalizedName) || FORBIDDEN_PATTERN.test(baseName)) {
            return 'FORBIDDEN';
        }

        if (HIGH_RISK_PATTERN.test(normalizedName) || HIGH_RISK_PATTERN.test(baseName)) {
            return 'HIGH_RISK';
        }

        if (LOW_RISK_PATTERN.test(normalizedName) || LOW_RISK_PATTERN.test(baseName)) {
            return 'LOW_RISK';
        }

        if (READ_ONLY_PATTERN.test(normalizedName) || READ_ONLY_PATTERN.test(baseName)) {
            return 'READ_ONLY';
        }

        // Fallback defensivo: se a ação não for explicitamente de leitura, trata como LOW_RISK
        return 'LOW_RISK';
    }

    /**
     * Avalia se uma ferramenta pode ser executada sob as políticas fornecidas.
     */
    evaluate(toolCall: ToolCall, policy?: ToolGovernancePolicy): ToolGovernanceDecision {
        const riskLevel = this.classify(toolCall.name, policy);

        // Verifica se o nível de risco é permitido na política
        if (policy?.allowedRiskLevels && !policy.allowedRiskLevels.includes(riskLevel)) {
            log.warn(
                { tool: toolCall.name, riskLevel, allowedLevels: policy.allowedRiskLevels },
                'Ferramenta bloqueada por não pertencer aos níveis de risco permitidos.'
            );
            return {
                allowed: false,
                riskLevel,
                reason: `O nível de risco "${riskLevel}" da ferramenta "${toolCall.name}" não é permitido pelas políticas do tenant.`,
            };
        }

        // Bloqueio incondicional de comandos FORBIDDEN
        if (riskLevel === 'FORBIDDEN') {
            log.warn(
                { tool: toolCall.name, riskLevel },
                'Ação destrutiva bloqueada pelo gate de segurança (FORBIDDEN).'
            );
            return {
                allowed: false,
                riskLevel,
                reason: `A ferramenta "${toolCall.name}" possui risco FORBIDDEN (ação destrutiva ou perigosa) e está bloqueada para execução autônoma.`,
            };
        }

        // Tratamento de ações HIGH_RISK (requerem aprovação humana exceto se liberadas explicitamente)
        if (riskLevel === 'HIGH_RISK') {
            if (policy?.allowHighRiskWithoutApproval) {
                log.info(
                    { tool: toolCall.name, riskLevel },
                    'Ferramenta HIGH_RISK liberada por override explícito do tenant.'
                );
                return {
                    allowed: true,
                    riskLevel,
                    reason: 'Execução permitida por override de política do tenant.',
                };
            }

            log.warn(
                { tool: toolCall.name, riskLevel },
                'Ação de alto risco suspensa aguardando aprovação operacional.'
            );
            return {
                allowed: false,
                riskLevel,
                requiresApproval: true,
                reason: `A ferramenta "${toolCall.name}" possui risco HIGH_RISK e requer aprovação humana prévia para execução.`,
            };
        }

        // Ferramentas READ_ONLY e LOW_RISK são liberadas
        return {
            allowed: true,
            riskLevel,
        };
    }

    private matchPattern(value: string, pattern: string | RegExp): boolean {
        if (pattern instanceof RegExp) {
            return pattern.test(value);
        }
        if (typeof pattern === 'string') {
            if (pattern.startsWith('/') && pattern.endsWith('/')) {
                try {
                    const regex = new RegExp(pattern.slice(1, -1), 'i');
                    return regex.test(value);
                } catch {
                    return value.toLowerCase().includes(pattern.toLowerCase());
                }
            }
            // Suporte a wildcard simples com '*' (ex: 'internal_*', '*_dump')
            if (pattern.includes('*')) {
                const regexStr = '^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$';
                return new RegExp(regexStr, 'i').test(value);
            }
            return value.toLowerCase() === pattern.toLowerCase() || value.toLowerCase().includes(pattern.toLowerCase());
        }
        return false;
    }
}
