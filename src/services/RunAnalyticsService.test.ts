import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RunAnalyticsService } from './RunAnalyticsService.js';
import type { IAgentRunRepository } from '../domain/ports/IAgentRunRepository.js';
import type { ISessionRepository } from '../domain/ports/ISessionRepository.js';
import { AgentRun } from '../domain/AgentRun.js';
import { InvestigationSession } from '../domain/InvestigationSession.js';
import { SessionStatus } from '../domain/SessionStatus.js';

describe('RunAnalyticsService', () => {
    let mockRepo: IAgentRunRepository;
    let mockSessionRepo: ISessionRepository;
    let service: RunAnalyticsService;

    beforeEach(() => {
        vi.clearAllMocks();

        mockRepo = {
            save: vi.fn(),
            findByRunId: vi.fn(),
            findByTenant: vi.fn(),
            findBySessionId: vi.fn(),
            aggregateCostByTenant: vi.fn(),
            aggregateToolAnalytics: vi.fn(),
            aggregateLLMAnalytics: vi.fn(),
        };

        mockSessionRepo = {
            createIndexes: vi.fn(),
            save: vi.fn(),
            findById: vi.fn(),
            findActiveByThreadId: vi.fn(),
            findInactiveSessions: vi.fn(),
        };

        service = new RunAnalyticsService(mockRepo, mockSessionRepo);
    });

    describe('getRunById', () => {
        it('deve retornar null se runId for vazio ou inválido', async () => {
            expect(await service.getRunById('')).toBeNull();
            expect(await service.getRunById('   ')).toBeNull();
            expect(await service.getRunById(null as any)).toBeNull();
            expect(mockRepo.findByRunId).not.toHaveBeenCalled();
        });

        it('deve buscar e retornar o run trimando o ID', async () => {
            const mockRun = new AgentRun('run-123', 'tenant-a', 'ws-1', 'thread-1');
            vi.mocked(mockRepo.findByRunId).mockResolvedValueOnce(mockRun);

            const result = await service.getRunById('  run-123  ');

            expect(mockRepo.findByRunId).toHaveBeenCalledWith('run-123');
            expect(result).toBe(mockRun);
        });

        it('deve repassar erro se o repositório falhar', async () => {
            vi.mocked(mockRepo.findByRunId).mockRejectedValueOnce(new Error('DB connection failed'));

            await expect(service.getRunById('run-err')).rejects.toThrow('DB connection failed');
        });
    });

    describe('listRuns', () => {
        it('deve lançar erro se tenantId for ausente ou vazio', async () => {
            await expect(service.listRuns('')).rejects.toThrow('O parâmetro tenantId é obrigatório.');
            await expect(service.listRuns('   ')).rejects.toThrow('O parâmetro tenantId é obrigatório.');
            await expect(service.listRuns(null as any)).rejects.toThrow('O parâmetro tenantId é obrigatório.');
        });

        it('deve normalizar paginação dentro dos limites seguros', async () => {
            vi.mocked(mockRepo.findByTenant).mockResolvedValueOnce([]);

            await service.listRuns('tenant-a', { limit: 200, offset: -5 });

            expect(mockRepo.findByTenant).toHaveBeenCalledWith('tenant-a', {
                limit: 100,
                offset: 0,
                status: undefined,
                from: undefined,
                to: undefined,
            });
        });

        it('deve aplicar limites mínimos padrão quando limit for <= 0', async () => {
            vi.mocked(mockRepo.findByTenant).mockResolvedValueOnce([]);

            await service.listRuns('tenant-a', { limit: 0, offset: 10 });

            expect(mockRepo.findByTenant).toHaveBeenCalledWith('tenant-a', {
                limit: 50,
                offset: 10,
                status: undefined,
                from: undefined,
                to: undefined,
            });
        });

        it('deve validar datas e lançar erro se from for posterior a to', async () => {
            const from = new Date('2026-09-10');
            const to = new Date('2026-09-05');

            await expect(service.listRuns('tenant-a', { from, to })).rejects.toThrow(
                'A data inicial (from) não pode ser posterior à data final (to).'
            );
        });

        it('deve ignorar datas inválidas silenciosamente', async () => {
            const invalidDate = new Date('invalid-date');
            vi.mocked(mockRepo.findByTenant).mockResolvedValueOnce([]);

            await service.listRuns('tenant-a', { from: invalidDate });

            expect(mockRepo.findByTenant).toHaveBeenCalledWith('tenant-a', {
                limit: 50,
                offset: 0,
                status: undefined,
                from: undefined,
                to: undefined,
            });
        });

        it('deve repassar erro se o repositório falhar', async () => {
            vi.mocked(mockRepo.findByTenant).mockRejectedValueOnce(new Error('Query timeout'));

            await expect(service.listRuns('tenant-a')).rejects.toThrow('Query timeout');
        });
    });

    describe('getCostAnalytics', () => {
        it('deve chamar aggregateCostByTenant com parâmetros limpos', async () => {
            const mockSummary = [
                {
                    tenantId: 'tenant-a',
                    totalRuns: 100,
                    totalCostUsd: 1.5,
                    avgCostUsd: 0.015,
                    totalTokens: 50000,
                    totalInputTokens: 35000,
                    totalOutputTokens: 15000,
                    avgDurationMs: 800,
                },
            ];
            vi.mocked(mockRepo.aggregateCostByTenant).mockResolvedValueOnce(mockSummary);

            const from = new Date('2026-09-01');
            const to = new Date('2026-09-07');

            const result = await service.getCostAnalytics('  tenant-a  ', from, to);

            expect(mockRepo.aggregateCostByTenant).toHaveBeenCalledWith('tenant-a', from, to);
            expect(result).toBe(mockSummary);
        });

        it('deve passar tenantId undefined se string for vazia', async () => {
            vi.mocked(mockRepo.aggregateCostByTenant).mockResolvedValueOnce([]);

            await service.getCostAnalytics('   ');

            expect(mockRepo.aggregateCostByTenant).toHaveBeenCalledWith(undefined, undefined, undefined);
        });

        it('deve lançar erro se from for posterior a to', async () => {
            await expect(
                service.getCostAnalytics('tenant-a', new Date('2026-09-10'), new Date('2026-09-01'))
            ).rejects.toThrow('A data inicial (from) não pode ser posterior à data final (to).');
        });

        it('deve repassar erro se o repositório falhar', async () => {
            vi.mocked(mockRepo.aggregateCostByTenant).mockRejectedValueOnce(new Error('Aggregation error'));

            await expect(service.getCostAnalytics()).rejects.toThrow('Aggregation error');
        });
    });

    describe('getToolAnalytics', () => {
        it('deve chamar aggregateToolAnalytics com parâmetros validados', async () => {
            const mockTools = [
                {
                    toolName: 'search_logs',
                    totalCalls: 50,
                    successfulCalls: 48,
                    failedCalls: 2,
                    successRate: 0.96,
                    avgDurationMs: 230,
                },
            ];
            vi.mocked(mockRepo.aggregateToolAnalytics).mockResolvedValueOnce(mockTools);

            const result = await service.getToolAnalytics('tenant-b');

            expect(mockRepo.aggregateToolAnalytics).toHaveBeenCalledWith('tenant-b', undefined, undefined);
            expect(result).toBe(mockTools);
        });

        it('deve lançar erro se from for posterior a to', async () => {
            await expect(
                service.getToolAnalytics(undefined, new Date('2026-09-10'), new Date('2026-09-01'))
            ).rejects.toThrow('A data inicial (from) não pode ser posterior à data final (to).');
        });

        it('deve repassar erro se o repositório falhar', async () => {
            vi.mocked(mockRepo.aggregateToolAnalytics).mockRejectedValueOnce(new Error('Tool pipeline failed'));

            await expect(service.getToolAnalytics('tenant-b')).rejects.toThrow('Tool pipeline failed');
        });
    });

    describe('getLLMAnalytics', () => {
        it('deve chamar aggregateLLMAnalytics com parâmetros validados', async () => {
            const mockLLM = [
                {
                    provider: 'openai',
                    model: 'gpt-4o',
                    totalCalls: 30,
                    totalInputTokens: 20000,
                    totalOutputTokens: 6000,
                    totalTokens: 26000,
                    totalCostUsd: 0.08,
                    avgLatencyMs: 700,
                },
            ];
            vi.mocked(mockRepo.aggregateLLMAnalytics).mockResolvedValueOnce(mockLLM);

            const result = await service.getLLMAnalytics('tenant-c');

            expect(mockRepo.aggregateLLMAnalytics).toHaveBeenCalledWith('tenant-c', undefined, undefined);
            expect(result).toBe(mockLLM);
        });

        it('deve lançar erro se from for posterior a to', async () => {
            await expect(
                service.getLLMAnalytics(undefined, new Date('2026-09-10'), new Date('2026-09-01'))
            ).rejects.toThrow('A data inicial (from) não pode ser posterior à data final (to).');
        });

        it('deve repassar erro se o repositório falhar', async () => {
            vi.mocked(mockRepo.aggregateLLMAnalytics).mockRejectedValueOnce(new Error('LLM pipeline failed'));

            await expect(service.getLLMAnalytics()).rejects.toThrow('LLM pipeline failed');
        });
    });

    describe('listRunsBySession', () => {
        it('deve retornar lista vazia se sessionId for nulo ou vazio', async () => {
            expect(await service.listRunsBySession('')).toEqual([]);
            expect(await service.listRunsBySession('   ')).toEqual([]);
            expect(await service.listRunsBySession(null as any)).toEqual([]);
            expect(mockRepo.findBySessionId).not.toHaveBeenCalled();
        });

        it('deve buscar e retornar runs associadas ao sessionId trimado', async () => {
            const run1 = new AgentRun('run-1', 'tenant-a', 'ws-1', 'thread-1');
            run1.sessionId = 'sess-123';
            const run2 = new AgentRun('run-2', 'tenant-a', 'ws-1', 'thread-1');
            run2.sessionId = 'sess-123';
            const mockRuns = [run1, run2];
            vi.mocked(mockRepo.findBySessionId).mockResolvedValueOnce(mockRuns);

            const result = await service.listRunsBySession('  sess-123  ');

            expect(mockRepo.findBySessionId).toHaveBeenCalledWith('sess-123');
            expect(result).toHaveLength(2);
            expect(result).toBe(mockRuns);
        });

        it('deve repassar erro se o repositório falhar', async () => {
            vi.mocked(mockRepo.findBySessionId).mockRejectedValueOnce(new Error('DB failure'));

            await expect(service.listRunsBySession('sess-err')).rejects.toThrow('DB failure');
        });
    });

    describe('getSessionAccounting', () => {
        it('deve retornar null se sessionId for vazio', async () => {
            expect(await service.getSessionAccounting('')).toBeNull();
            expect(await service.getSessionAccounting('   ')).toBeNull();
            expect(await service.getSessionAccounting(null as any)).toBeNull();
        });

        it('deve lançar erro se sessionRepository não estiver configurado', async () => {
            const serviceWithoutRepo = new RunAnalyticsService(mockRepo);
            await expect(serviceWithoutRepo.getSessionAccounting('sess-1')).rejects.toThrow(
                'ISessionRepository não configurado no RunAnalyticsService.'
            );
        });

        it('deve retornar null se sessão não existir', async () => {
            vi.mocked(mockSessionRepo.findById).mockResolvedValueOnce(null);

            const result = await service.getSessionAccounting('sess-not-found');

            expect(mockSessionRepo.findById).toHaveBeenCalledWith('sess-not-found');
            expect(result).toBeNull();
        });

        it('deve retornar resumo consolidado com tokens, custo e contagem de runs de sessão ativa', async () => {
            const startedAt = new Date(Date.now() - 60_000);
            const lastInteractionAt = new Date();
            const session = new InvestigationSession({
                id: 'sess-act',
                workspaceId: 'ws-1',
                threadId: 'th-1',
                channelId: 'chan-1',
                status: SessionStatus.ACTIVE,
                startedAt,
                lastInteractionAt,
                promptTokens: 1500,
                completionTokens: 500,
                totalTokens: 2000,
                estimatedCostUsd: 0.025,
                turnCount: 3,
            });

            vi.mocked(mockSessionRepo.findById).mockResolvedValueOnce(session);
            vi.mocked(mockRepo.findBySessionId).mockResolvedValueOnce([
                new AgentRun('r-1', 'tenant-a', 'ws-1', 'th-1', 'running', 0, [], new Date(), undefined, undefined, 'sess-act'),
                new AgentRun('r-2', 'tenant-a', 'ws-1', 'th-1', 'running', 0, [], new Date(), undefined, undefined, 'sess-act'),
                new AgentRun('r-3', 'tenant-a', 'ws-1', 'th-1', 'running', 0, [], new Date(), undefined, undefined, 'sess-act'),
            ]);

            const result = await service.getSessionAccounting('  sess-act  ');

            expect(mockSessionRepo.findById).toHaveBeenCalledWith('sess-act');
            expect(mockRepo.findBySessionId).toHaveBeenCalledWith('sess-act');
            expect(result).not.toBeNull();
            expect(result).toMatchObject({
                sessionId: 'sess-act',
                workspaceId: 'ws-1',
                threadId: 'th-1',
                channelId: 'chan-1',
                status: SessionStatus.ACTIVE,
                turnCount: 3,
                tokens: {
                    promptTokens: 1500,
                    completionTokens: 500,
                    totalTokens: 2000,
                    estimatedCostUsd: 0.025,
                },
                runsCount: 3,
            });
            expect(result?.durationSeconds).toBeGreaterThanOrEqual(59);
        });

        it('deve calcular durationSeconds corretamente para sessão encerrada', async () => {
            const startedAt = new Date('2026-09-23T10:00:00.000Z');
            const closedAt = new Date('2026-09-23T10:15:30.000Z'); // 930 segundos
            const session = new InvestigationSession({
                id: 'sess-closed',
                workspaceId: 'ws-1',
                threadId: 'th-1',
                status: SessionStatus.CLOSED_BY_USER,
                startedAt,
                closedAt,
                promptTokens: 3000,
                completionTokens: 1000,
                totalTokens: 4000,
                estimatedCostUsd: 0.05,
                turnCount: 4,
            });

            vi.mocked(mockSessionRepo.findById).mockResolvedValueOnce(session);
            vi.mocked(mockRepo.findBySessionId).mockResolvedValueOnce([]);

            const result = await service.getSessionAccounting('sess-closed');

            expect(result?.durationSeconds).toBe(930);
            expect(result?.closedAt).toEqual(closedAt);
            expect(result?.runsCount).toBe(0);
        });
    });
});
