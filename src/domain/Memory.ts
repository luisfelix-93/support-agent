import type { MessageRole } from "./Message.js";

export type MemoryType =
    | 'fact'
    | 'preference'
    | 'incident'
    | 'resolution'
    | 'knowledge'
    | 'summary';

export type MemoryStatus =
    | 'candidate'
    | 'validated'
    | 'active'
    | 'updated'
    | 'expired';

export interface Memory {
    id: string;
    tenantId: string;
    workspaceId: string;
    threadId?: string;
    type: MemoryType;
    status: MemoryStatus;
    content: string;
    importance: number; // 0.0 a 1.0
    confidenceScore?: number; // 0.0 a 1.0
    tags?: string[];
    ttlSeconds?: number;
    expiresAt?: Date;
    validatedBy?: string;
    embedding?: number[];
    metadata?: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
}

export interface MemorySearchInput {
    tenantId: string;
    workspaceId: string;
    query?: string;
    vector?: number[];
    limit?: number;
    threshold?: number;
    type?: MemoryType;
    status?: MemoryStatus;
}

export interface HybridMemorySearchInput {
    tenantId: string;
    workspaceId: string;
    query: string;
    vector?: number[];
    limit?: number;
    threshold?: number;
    types?: MemoryType[];
    statuses?: MemoryStatus[];
    tags?: string[];
    weights?: {
        vector?: number;
        text?: number;
    };
}

export interface HybridSearchResult {
    memory: Memory;
    score: number;
    vectorRank?: number;
    textRank?: number;
    vectorScore?: number;
    textScore?: number;
}

export interface MemoryPromotionJobData {
    tenantId: string;
    workspaceId: string;
    threadId: string;
    messages: Array<{ role: MessageRole; content: string }>;
    traceContext?: Record<string, string>;
}

/**
 * Regras e validações de ciclo de vida de memória corporativa
 */
export class MemoryLifecycle {
    private static readonly ALLOWED_TRANSITIONS: Record<MemoryStatus, MemoryStatus[]> = {
        candidate: ['validated', 'active', 'expired'],
        validated: ['active', 'updated', 'expired'],
        active: ['updated', 'expired'],
        updated: ['active', 'expired'],
        expired: ['active', 'candidate'], // Permite reativação ou recandidatura por operador
    };

    /**
     * Valida se uma transição de status é permitida pela máquina de estados.
     */
    static canTransition(from: MemoryStatus, to: MemoryStatus): boolean {
        if (from === to) return true;
        const allowed = this.ALLOWED_TRANSITIONS[from];
        return allowed ? allowed.includes(to) : false;
    }

    /**
     * Calcula a data de expiração (expiresAt) com base no TTL em segundos.
     */
    static calculateExpiresAt(ttlSeconds?: number, fromDate: Date = new Date()): Date | undefined {
        if (ttlSeconds === undefined || ttlSeconds === null || ttlSeconds <= 0) {
            return undefined;
        }
        return new Date(fromDate.getTime() + ttlSeconds * 1000);
    }

    /**
     * Retorna o TTL padrão recomendado em segundos por categoria de memória.
     */
    static getDefaultTtlSeconds(type: MemoryType): number | undefined {
        switch (type) {
            case 'incident':
                return 30 * 24 * 60 * 60; // 30 dias
            case 'resolution':
                return 90 * 24 * 60 * 60; // 90 dias
            case 'summary':
                return 15 * 24 * 60 * 60; // 15 dias
            case 'fact':
            case 'knowledge':
            case 'preference':
            default:
                return undefined; // Permanente (sem TTL fixo)
        }
    }

    /**
     * Determina o status inicial com base no score de confiança da extração.
     */
    static determineInitialStatus(confidenceScore?: number, threshold: number = 0.8): MemoryStatus {
        if (typeof confidenceScore === 'number') {
            return confidenceScore >= threshold ? 'active' : 'candidate';
        }
        return 'active';
    }
}
