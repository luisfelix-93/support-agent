import type { Collection } from 'mongodb';
import { MongoConnection } from '../infrastructure/database/MongoConnection.js';
import { InvestigationSession } from '../domain/InvestigationSession.js';
import { SessionStatus } from '../domain/SessionStatus.js';
import { EvidenceLedger } from '../domain/workflows/EvidenceLedger.js';
import { SessionSummary } from '../domain/workflows/SessionSummary.js';
import type { ISessionRepository } from '../domain/ports/ISessionRepository.js';
import { logger } from '../config/logger.js';

const log = logger.child({ module: 'MongoSessionRepository' });

export interface InvestigationSessionDocument {
    _id?: any;
    id: string;
    workspaceId: string;
    threadId: string;
    channelId?: string;
    status: SessionStatus;
    startedAt: Date;
    lastInteractionAt: Date;
    closedAt: Date | null;
    idleTimeoutMs: number;
    evidenceLedger: {
        logs: any[];
        metrics: any[];
        traces: any[];
        infrastructure: any[];
        database: any[];
    };
    sessionSummary: any | null;
    metadata: Record<string, unknown>;
    updatedAt: Date;
}

export class MongoSessionRepository implements ISessionRepository {
    private get collection(): Collection<InvestigationSessionDocument> {
        return MongoConnection.getDb().collection<InvestigationSessionDocument>('investigation_sessions');
    }

    async createIndexes(): Promise<void> {
        try {
            await this.collection.createIndex({ id: 1 }, { unique: true });
            await this.collection.createIndex({ workspaceId: 1, threadId: 1, status: 1 });
            await this.collection.createIndex({ status: 1, lastInteractionAt: 1 });
            log.info('Índices de investigation_sessions criados com sucesso.');
        } catch (error) {
            log.error({ err: error }, 'Erro ao criar índices de investigation_sessions.');
            throw error;
        }
    }

    async save(session: InvestigationSession): Promise<void> {
        const doc = this.toDocument(session);
        await this.collection.updateOne(
            { id: session.id },
            { $set: doc },
            { upsert: true }
        );
        log.debug({ sessionId: session.id, status: session.status }, 'InvestigationSession persistida com sucesso.');
    }

    async findById(id: string): Promise<InvestigationSession | null> {
        const doc = await this.collection.findOne({ id });
        if (!doc) {
            return null;
        }
        return this.toDomain(doc);
    }

    async findActiveByThreadId(threadId: string, workspaceId: string): Promise<InvestigationSession | null> {
        const doc = await this.collection.findOne(
            {
                threadId,
                workspaceId,
                status: {
                    $in: [SessionStatus.ACTIVE, SessionStatus.AWAITING_CLOSURE_CONFIRMATION],
                },
            },
            { sort: { lastInteractionAt: -1 } }
        );

        if (!doc) {
            return null;
        }
        return this.toDomain(doc);
    }

    async findInactiveSessions(cutoffDate: Date, limit: number = 50): Promise<InvestigationSession[]> {
        const cursor = this.collection
            .find({
                status: {
                    $in: [SessionStatus.ACTIVE, SessionStatus.AWAITING_CLOSURE_CONFIRMATION],
                },
                lastInteractionAt: { $lte: cutoffDate },
            })
            .limit(limit);

        const docs = await cursor.toArray();
        return docs.map(doc => this.toDomain(doc));
    }

    private toDocument(session: InvestigationSession): InvestigationSessionDocument {
        return {
            id: session.id,
            workspaceId: session.workspaceId,
            threadId: session.threadId,
            channelId: session.channelId,
            status: session.status,
            startedAt: session.startedAt,
            lastInteractionAt: session.lastInteractionAt,
            closedAt: session.closedAt,
            idleTimeoutMs: session.idleTimeoutMs,
            evidenceLedger: {
                logs: [...session.evidenceLedger.getLogs()],
                metrics: [...session.evidenceLedger.getMetrics()],
                traces: [...session.evidenceLedger.getTraces()],
                infrastructure: [...session.evidenceLedger.getInfrastructure()],
                database: [...session.evidenceLedger.getDatabase()],
            },
            sessionSummary: session.sessionSummary
                ? {
                      runId: session.sessionSummary.runId,
                      serviceName: session.sessionSummary.serviceName,
                      incidentWindow: session.sessionSummary.incidentWindow,
                      rootCauseHypothesis: session.sessionSummary.rootCauseHypothesis,
                      evidence: session.sessionSummary.evidence,
                      recommendedActions: session.sessionSummary.recommendedActions,
                      playbooksInvolved: session.sessionSummary.playbooksInvolved,
                  }
                : null,
            metadata: session.metadata,
            updatedAt: new Date(),
        };
    }

    private toDomain(doc: InvestigationSessionDocument): InvestigationSession {
        const ledger = new EvidenceLedger();
        if (doc.evidenceLedger) {
            for (const logItem of doc.evidenceLedger.logs || []) {
                ledger.addLog(logItem);
            }
            for (const metric of doc.evidenceLedger.metrics || []) {
                ledger.addMetric(metric);
            }
            for (const trace of doc.evidenceLedger.traces || []) {
                ledger.addTrace(trace);
            }
            for (const infra of doc.evidenceLedger.infrastructure || []) {
                ledger.addInfrastructure(infra);
            }
            for (const db of doc.evidenceLedger.database || []) {
                ledger.addDatabase(db);
            }
        }

        let summary: SessionSummary | null = null;
        if (doc.sessionSummary) {
            summary = new SessionSummary({
                runId: doc.sessionSummary.runId,
                serviceName: doc.sessionSummary.serviceName,
                incidentWindow: doc.sessionSummary.incidentWindow,
                rootCauseHypothesis: doc.sessionSummary.rootCauseHypothesis,
                evidence: doc.sessionSummary.evidence,
                recommendedActions: doc.sessionSummary.recommendedActions,
                playbooksInvolved: doc.sessionSummary.playbooksInvolved,
            });
        }

        const session = new InvestigationSession({
            id: doc.id,
            workspaceId: doc.workspaceId,
            threadId: doc.threadId,
            channelId: doc.channelId,
            status: doc.status,
            startedAt: doc.startedAt ? new Date(doc.startedAt) : undefined,
            lastInteractionAt: doc.lastInteractionAt ? new Date(doc.lastInteractionAt) : undefined,
            closedAt: doc.closedAt ? new Date(doc.closedAt) : null,
            idleTimeoutMs: doc.idleTimeoutMs,
            evidenceLedger: ledger,
            sessionSummary: summary,
            metadata: doc.metadata,
        });

        return session;
    }
}
