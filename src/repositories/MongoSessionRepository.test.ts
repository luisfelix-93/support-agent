import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MongoSessionRepository } from './MongoSessionRepository.js';
import { InvestigationSession } from '../domain/InvestigationSession.js';
import { SessionStatus } from '../domain/SessionStatus.js';
import { SessionSummary } from '../domain/workflows/SessionSummary.js';
import { MongoConnection } from '../infrastructure/database/MongoConnection.js';

vi.mock('../infrastructure/database/MongoConnection.js', () => ({
    MongoConnection: {
        getDb: vi.fn(),
    },
}));

describe('MongoSessionRepository', () => {
    let mockCollection: any;
    let repository: MongoSessionRepository;

    const createMockSummary = () =>
        new SessionSummary({
            runId: 'run-999',
            serviceName: 'billing-api',
            incidentWindow: { start: '10:00', end: '10:30' },
            rootCauseHypothesis: 'Database deadlock in transaction',
            evidence: {
                logs: ['Deadlock detected on tx_123'],
                metrics: ['db_deadlocks_total = 12'],
                traces: ['trace-abc: 4500ms'],
                infra: ['Pod billing-api restarted'],
                database: ['Lock wait timeout 50s'],
            },
            recommendedActions: ['Kill blocking PID', 'Optimize transaction scope'],
            playbooksInvolved: ['database', 'api-error'],
        });

    beforeEach(() => {
        vi.clearAllMocks();

        mockCollection = {
            findOne: vi.fn(),
            find: vi.fn(),
            updateOne: vi.fn().mockResolvedValue({ acknowledged: true }),
            createIndex: vi.fn().mockResolvedValue('index-created'),
        };

        vi.mocked(MongoConnection.getDb).mockReturnValue({
            collection: vi.fn().mockReturnValue(mockCollection),
        } as any);

        repository = new MongoSessionRepository();
    });

    describe('createIndexes', () => {
        it('deve criar os índices de id, busca por thread e inatividade para sweeper', async () => {
            await repository.createIndexes();

            expect(mockCollection.createIndex).toHaveBeenCalledTimes(3);
            expect(mockCollection.createIndex).toHaveBeenCalledWith({ id: 1 }, { unique: true });
            expect(mockCollection.createIndex).toHaveBeenCalledWith({ workspaceId: 1, threadId: 1, status: 1 });
            expect(mockCollection.createIndex).toHaveBeenCalledWith({ status: 1, lastInteractionAt: 1 });
        });
    });

    describe('save', () => {
        it('deve persistir a sessão com upsert baseado em id', async () => {
            const session = new InvestigationSession({
                id: 'sess-1',
                workspaceId: 'ws-acme',
                threadId: 'th-100',
                channelId: 'slack-incidents',
                idleTimeoutMs: 3600000,
                metadata: { priority: 'P1' },
            });
            session.evidenceLedger.addLog({ message: '502 Bad Gateway', level: 'error' });
            session.evidenceLedger.addMetric({ query: 'http_requests_total', value: 500 });
            session.evidenceLedger.addTrace({
                traceId: 'tr-1',
                operationName: 'checkout',
                durationMs: 3200,
                error: true,
            });
            session.evidenceLedger.addInfrastructure({ component: 'k8s-pod', status: 'CrashLoopBackOff' });
            session.evidenceLedger.addDatabase({ metricOrQuery: 'active_connections', value: 98 });

            await repository.save(session);

            expect(mockCollection.updateOne).toHaveBeenCalledWith(
                { id: 'sess-1' },
                {
                    $set: expect.objectContaining({
                        id: 'sess-1',
                        workspaceId: 'ws-acme',
                        threadId: 'th-100',
                        channelId: 'slack-incidents',
                        status: SessionStatus.ACTIVE,
                        idleTimeoutMs: 3600000,
                        metadata: { priority: 'P1' },
                        sessionSummary: null,
                        evidenceLedger: {
                            logs: [{ message: '502 Bad Gateway', level: 'error' }],
                            metrics: [{ query: 'http_requests_total', value: 500 }],
                            traces: [{ traceId: 'tr-1', operationName: 'checkout', durationMs: 3200, error: true }],
                            infrastructure: [{ component: 'k8s-pod', status: 'CrashLoopBackOff' }],
                            database: [{ metricOrQuery: 'active_connections', value: 98 }],
                        },
                    }),
                },
                { upsert: true }
            );
        });

        it('deve serializar SessionSummary quando a sessão for concluída', async () => {
            const session = new InvestigationSession({
                id: 'sess-2',
                workspaceId: 'ws-acme',
                threadId: 'th-200',
            });
            const summary = createMockSummary();
            session.confirmClosure(summary);

            await repository.save(session);

            expect(mockCollection.updateOne).toHaveBeenCalledWith(
                { id: 'sess-2' },
                {
                    $set: expect.objectContaining({
                        id: 'sess-2',
                        status: SessionStatus.CLOSED_BY_USER,
                        sessionSummary: expect.objectContaining({
                            runId: 'run-999',
                            serviceName: 'billing-api',
                            rootCauseHypothesis: 'Database deadlock in transaction',
                            recommendedActions: ['Kill blocking PID', 'Optimize transaction scope'],
                        }),
                    }),
                },
                { upsert: true }
            );
        });
    });

    describe('findById', () => {
        it('deve retornar null se a sessão não for encontrada', async () => {
            mockCollection.findOne.mockResolvedValue(null);

            const result = await repository.findById('inexistente');

            expect(result).toBeNull();
            expect(mockCollection.findOne).toHaveBeenCalledWith({ id: 'inexistente' });
        });

        it('deve reidratar corretamente a InvestigationSession a partir do documento do banco', async () => {
            const mockDoc = {
                id: 'sess-doc-1',
                workspaceId: 'ws-test',
                threadId: 'th-300',
                channelId: 'chan-1',
                status: SessionStatus.AWAITING_CLOSURE_CONFIRMATION,
                startedAt: new Date('2026-09-18T10:00:00.000Z'),
                lastInteractionAt: new Date('2026-09-18T10:45:00.000Z'),
                closedAt: null,
                idleTimeoutMs: 1800000,
                evidenceLedger: {
                    logs: [{ message: 'Out of memory', level: 'critical' }],
                    metrics: [{ query: 'memory_usage_bytes', value: 1073741824 }],
                    traces: [{ traceId: 'tr-oom', operationName: 'batch', durationMs: 15000 }],
                    infrastructure: [{ component: 'worker-node-1', status: 'NotReady' }],
                    database: [{ metricOrQuery: 'pool_size', value: 10 }],
                },
                sessionSummary: {
                    runId: 'run-oom',
                    serviceName: 'batch-worker',
                    rootCauseHypothesis: 'Memory leak in batch processing',
                    evidence: {
                        logs: ['Out of memory'],
                        metrics: ['1GB'],
                        traces: [],
                        infra: [],
                        database: [],
                    },
                    recommendedActions: ['Aumentar limites no pod'],
                    playbooksInvolved: ['kubernetes'],
                },
                metadata: { cluster: 'us-east-1' },
            };

            mockCollection.findOne.mockResolvedValue(mockDoc);

            const session = await repository.findById('sess-doc-1');

            expect(session).not.toBeNull();
            expect(session!.id).toBe('sess-doc-1');
            expect(session!.workspaceId).toBe('ws-test');
            expect(session!.threadId).toBe('th-300');
            expect(session!.status).toBe(SessionStatus.AWAITING_CLOSURE_CONFIRMATION);
            expect(session!.idleTimeoutMs).toBe(1800000);
            expect(session!.evidenceLedger.getLogs()).toHaveLength(1);
            expect(session!.evidenceLedger.getLogs()[0].message).toBe('Out of memory');
            expect(session!.sessionSummary).toBeInstanceOf(SessionSummary);
            expect(session!.sessionSummary!.rootCauseHypothesis).toBe('Memory leak in batch processing');
            expect(session!.metadata).toEqual({ cluster: 'us-east-1' });
        });
    });

    describe('findActiveByThreadId', () => {
        it('deve buscar sessão ativa (ACTIVE ou AWAITING_CLOSURE_CONFIRMATION) pela thread e workspace', async () => {
            const mockDoc = {
                id: 'sess-active',
                workspaceId: 'ws-acme',
                threadId: 'th-thread-1',
                status: SessionStatus.ACTIVE,
                startedAt: new Date(),
                lastInteractionAt: new Date(),
                closedAt: null,
                idleTimeoutMs: 3600000,
                evidenceLedger: { logs: [], metrics: [], traces: [], infrastructure: [], database: [] },
                sessionSummary: null,
                metadata: {},
            };

            mockCollection.findOne.mockResolvedValue(mockDoc);

            const result = await repository.findActiveByThreadId('th-thread-1', 'ws-acme');

            expect(mockCollection.findOne).toHaveBeenCalledWith(
                {
                    threadId: 'th-thread-1',
                    workspaceId: 'ws-acme',
                    status: {
                        $in: [SessionStatus.ACTIVE, SessionStatus.AWAITING_CLOSURE_CONFIRMATION],
                    },
                },
                { sort: { lastInteractionAt: -1 } }
            );
            expect(result).not.toBeNull();
            expect(result!.id).toBe('sess-active');
        });

        it('deve retornar null se não houver sessão ativa na thread', async () => {
            mockCollection.findOne.mockResolvedValue(null);

            const result = await repository.findActiveByThreadId('th-closed', 'ws-acme');

            expect(result).toBeNull();
        });
    });

    describe('findInactiveSessions', () => {
        it('deve buscar sessões ativas cujo lastInteractionAt seja anterior ao cutoffDate', async () => {
            const cutoffDate = new Date('2026-09-18T10:00:00.000Z');
            const mockDocs = [
                {
                    id: 'sess-expired-1',
                    workspaceId: 'ws-1',
                    threadId: 'th-1',
                    status: SessionStatus.ACTIVE,
                    startedAt: new Date('2026-09-18T08:30:00.000Z'),
                    lastInteractionAt: new Date('2026-09-18T08:55:00.000Z'),
                    closedAt: null,
                    idleTimeoutMs: 3600000,
                    evidenceLedger: { logs: [], metrics: [], traces: [], infrastructure: [], database: [] },
                    sessionSummary: null,
                    metadata: {},
                },
                {
                    id: 'sess-expired-2',
                    workspaceId: 'ws-2',
                    threadId: 'th-2',
                    status: SessionStatus.AWAITING_CLOSURE_CONFIRMATION,
                    startedAt: new Date('2026-09-18T08:00:00.000Z'),
                    lastInteractionAt: new Date('2026-09-18T09:00:00.000Z'),
                    closedAt: null,
                    idleTimeoutMs: 3600000,
                    evidenceLedger: { logs: [], metrics: [], traces: [], infrastructure: [], database: [] },
                    sessionSummary: null,
                    metadata: {},
                },
            ];

            const mockCursor = {
                limit: vi.fn().mockReturnThis(),
                toArray: vi.fn().mockResolvedValue(mockDocs),
            };
            mockCollection.find.mockReturnValue(mockCursor);

            const results = await repository.findInactiveSessions(cutoffDate, 20);

            expect(mockCollection.find).toHaveBeenCalledWith({
                status: {
                    $in: [SessionStatus.ACTIVE, SessionStatus.AWAITING_CLOSURE_CONFIRMATION],
                },
                lastInteractionAt: { $lte: cutoffDate },
            });
            expect(mockCursor.limit).toHaveBeenCalledWith(20);
            expect(results).toHaveLength(2);
            expect(results[0].id).toBe('sess-expired-1');
            expect(results[1].id).toBe('sess-expired-2');
        });
    });
});
