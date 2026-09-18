import type { InvestigationSession } from '../InvestigationSession.js';

export interface ISessionRepository {
    createIndexes(): Promise<void>;
    save(session: InvestigationSession): Promise<void>;
    findById(id: string): Promise<InvestigationSession | null>;
    findActiveByThreadId(threadId: string, workspaceId: string): Promise<InvestigationSession | null>;
    findInactiveSessions(cutoffDate: Date, limit?: number): Promise<InvestigationSession[]>;
}
