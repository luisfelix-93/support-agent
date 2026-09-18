import { SessionStatus } from './SessionStatus.js';
import { EvidenceLedger } from './workflows/EvidenceLedger.js';
import type { SessionSummary } from './workflows/SessionSummary.js';

export interface InvestigationSessionProps {
    id: string;
    workspaceId: string;
    threadId: string;
    channelId?: string;
    status?: SessionStatus;
    startedAt?: Date;
    lastInteractionAt?: Date;
    closedAt?: Date | null;
    idleTimeoutMs?: number;
    evidenceLedger?: EvidenceLedger;
    sessionSummary?: SessionSummary | null;
    metadata?: Record<string, unknown>;
}

export class InvestigationSession {
    public readonly id: string;
    public readonly workspaceId: string;
    public readonly threadId: string;
    public readonly channelId?: string;
    public status: SessionStatus;
    public readonly startedAt: Date;
    public lastInteractionAt: Date;
    public closedAt: Date | null;
    public readonly idleTimeoutMs: number;
    public readonly evidenceLedger: EvidenceLedger;
    public sessionSummary: SessionSummary | null;
    public readonly metadata: Record<string, unknown>;

    constructor(props: InvestigationSessionProps) {
        if (!props.id || props.id.trim() === '') {
            throw new Error('O identificador (id) da sessão é obrigatório.');
        }
        if (!props.workspaceId || props.workspaceId.trim() === '') {
            throw new Error('O workspaceId da sessão é obrigatório.');
        }
        if (!props.threadId || props.threadId.trim() === '') {
            throw new Error('O threadId da sessão é obrigatório.');
        }

        const idleTimeout = props.idleTimeoutMs ?? 3_600_000;
        if (idleTimeout <= 0) {
            throw new Error('idleTimeoutMs deve ser maior que zero.');
        }

        this.id = props.id.trim();
        this.workspaceId = props.workspaceId.trim();
        this.threadId = props.threadId.trim();
        this.channelId = props.channelId?.trim();
        this.status = props.status ?? SessionStatus.ACTIVE;
        this.startedAt = props.startedAt ?? new Date();
        this.lastInteractionAt = props.lastInteractionAt ?? new Date(this.startedAt.getTime());
        this.closedAt = props.closedAt ?? null;
        this.idleTimeoutMs = idleTimeout;
        this.evidenceLedger = props.evidenceLedger ?? new EvidenceLedger();
        this.sessionSummary = props.sessionSummary ?? null;
        this.metadata = props.metadata ? { ...props.metadata } : {};
    }

    isClosed(): boolean {
        return (
            this.status === SessionStatus.CLOSED_BY_USER ||
            this.status === SessionStatus.CLOSED_BY_TIMEOUT
        );
    }

    touch(interactionTime: Date = new Date()): void {
        if (this.isClosed()) {
            throw new Error('Não é possível interagir com uma sessão encerrada.');
        }
        this.lastInteractionAt = interactionTime;
    }

    proposeClosure(): void {
        if (this.isClosed()) {
            throw new Error('Sessão já está encerrada.');
        }
        this.status = SessionStatus.AWAITING_CLOSURE_CONFIRMATION;
    }

    cancelClosureProposal(): void {
        if (this.isClosed()) {
            throw new Error('Sessão já está encerrada.');
        }
        this.status = SessionStatus.ACTIVE;
    }

    confirmClosure(summary?: SessionSummary, closedAt: Date = new Date()): void {
        if (this.isClosed()) {
            throw new Error('Sessão já foi encerrada anteriormente.');
        }
        this.status = SessionStatus.CLOSED_BY_USER;
        this.closedAt = closedAt;
        if (summary) {
            this.sessionSummary = summary;
        }
    }

    expireByTimeout(summary?: SessionSummary, expiredAt: Date = new Date()): void {
        if (this.isClosed()) {
            throw new Error('Sessão já foi encerrada anteriormente.');
        }
        this.status = SessionStatus.CLOSED_BY_TIMEOUT;
        this.closedAt = expiredAt;
        if (summary) {
            this.sessionSummary = summary;
        }
    }

    isExpired(referenceDate: Date = new Date()): boolean {
        if (this.isClosed()) {
            return false;
        }
        const delta = referenceDate.getTime() - this.lastInteractionAt.getTime();
        return delta >= this.idleTimeoutMs;
    }

    setSessionSummary(summary: SessionSummary): void {
        if (this.isClosed()) {
            throw new Error('Não é possível modificar o resumo de uma sessão já encerrada.');
        }
        this.sessionSummary = summary;
    }
}
