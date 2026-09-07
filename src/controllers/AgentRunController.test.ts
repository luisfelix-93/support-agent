import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRunController } from './AgentRunController.js';
import type { RunAnalyticsService } from '../services/RunAnalyticsService.js';
import { AgentRun } from '../domain/AgentRun.js';

describe('AgentRunController', () => {
    let mockService: RunAnalyticsService;
    let controller: AgentRunController;
    let mockReq: any;
    let mockRes: any;

    beforeEach(() => {
        vi.clearAllMocks();

        mockService = {
            getRunById: vi.fn(),
            listRuns: vi.fn(),
            getCostAnalytics: vi.fn(),
            getToolAnalytics: vi.fn(),
            getLLMAnalytics: vi.fn(),
        } as unknown as RunAnalyticsService;

        controller = new AgentRunController(mockService);

        mockRes = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
        };
    });

    describe('getById', () => {
        it('deve retornar 400 se runId for vazio', async () => {
            mockReq = { params: { runId: '   ' } };

            await controller.getById(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({ error: 'O parâmetro runId é obrigatório.' });
        });

        it('deve retornar 404 se execução não for encontrada', async () => {
            mockReq = { params: { runId: 'run-999' } };
            vi.mocked(mockService.getRunById).mockResolvedValueOnce(null);

            await controller.getById(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                error: 'Execução não encontrada para o runId informado.',
            });
        });

        it('deve retornar 200 com os dados quando a execução existir', async () => {
            const mockRun = new AgentRun('run-123', 'tenant-a', 'ws-1', 'thread-1');
            mockReq = { params: { runId: 'run-123' } };
            vi.mocked(mockService.getRunById).mockResolvedValueOnce(mockRun);

            await controller.getById(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({ success: true, data: mockRun });
        });

        it('deve retornar 500 se o serviço lançar erro inesperado', async () => {
            mockReq = { params: { runId: 'run-123' } };
            vi.mocked(mockService.getRunById).mockRejectedValueOnce(new Error('Database crash'));

            await controller.getById(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(500);
            expect(mockRes.json).toHaveBeenCalledWith({ error: 'Erro interno ao buscar execução.' });
        });
    });

    describe('list', () => {
        it('deve retornar 400 se tenantId for ausente', async () => {
            mockReq = { query: {} };

            await controller.list(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({
                error: 'O query parameter tenantId é obrigatório.',
            });
        });

        it('deve retornar 200 com lista e count', async () => {
            const mockRuns = [new AgentRun('run-1', 'tenant-a', 'ws-1', 'thread-1')];
            mockReq = {
                query: {
                    tenantId: 'tenant-a',
                    status: 'completed',
                    limit: '10',
                    offset: '0',
                    from: '2026-09-01T00:00:00Z',
                    to: '2026-09-07T00:00:00Z',
                },
            };
            vi.mocked(mockService.listRuns).mockResolvedValueOnce(mockRuns);

            await controller.list(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({
                success: true,
                data: mockRuns,
                count: 1,
            });
        });

        it('deve retornar 400 se as datas forem inconsistentes (from > to)', async () => {
            mockReq = {
                query: {
                    tenantId: 'tenant-a',
                    from: '2026-09-10',
                    to: '2026-09-01',
                },
            };
            vi.mocked(mockService.listRuns).mockRejectedValueOnce(
                new Error('A data inicial (from) não pode ser posterior à data final (to).')
            );

            await controller.list(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({
                error: 'A data inicial (from) não pode ser posterior à data final (to).',
            });
        });

        it('deve retornar 500 em erro interno', async () => {
            mockReq = { query: { tenantId: 'tenant-a' } };
            vi.mocked(mockService.listRuns).mockRejectedValueOnce(new Error('Timeout'));

            await controller.list(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(500);
            expect(mockRes.json).toHaveBeenCalledWith({
                error: 'Erro interno ao listar execuções.',
            });
        });
    });

    describe('getCostAnalytics', () => {
        it('deve retornar 200 com as métricas agregadas de custo', async () => {
            const mockData = [{ tenantId: 'tenant-a', totalRuns: 5, totalCostUsd: 0.1 }];
            mockReq = { query: { tenantId: 'tenant-a' } };
            vi.mocked(mockService.getCostAnalytics).mockResolvedValueOnce(mockData as any);

            await controller.getCostAnalytics(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({ success: true, data: mockData });
        });

        it('deve retornar 400 se from for posterior a to', async () => {
            mockReq = { query: { from: '2026-09-10', to: '2026-09-01' } };
            vi.mocked(mockService.getCostAnalytics).mockRejectedValueOnce(
                new Error('A data inicial (from) não pode ser posterior à data final (to).')
            );

            await controller.getCostAnalytics(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(400);
        });

        it('deve retornar 500 em erro interno', async () => {
            mockReq = { query: {} };
            vi.mocked(mockService.getCostAnalytics).mockRejectedValueOnce(new Error('Internal failure'));

            await controller.getCostAnalytics(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(500);
        });
    });

    describe('getToolAnalytics', () => {
        it('deve retornar 200 com analytics de ferramentas', async () => {
            const mockData = [{ toolName: 'get_logs', totalCalls: 10, successRate: 1 }];
            mockReq = { query: {} };
            vi.mocked(mockService.getToolAnalytics).mockResolvedValueOnce(mockData as any);

            await controller.getToolAnalytics(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({ success: true, data: mockData });
        });

        it('deve retornar 400 se from for posterior a to', async () => {
            mockReq = { query: { from: '2026-09-10', to: '2026-09-01' } };
            vi.mocked(mockService.getToolAnalytics).mockRejectedValueOnce(
                new Error('A data inicial (from) não pode ser posterior à data final (to).')
            );

            await controller.getToolAnalytics(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(400);
        });

        it('deve retornar 500 em erro interno', async () => {
            mockReq = { query: {} };
            vi.mocked(mockService.getToolAnalytics).mockRejectedValueOnce(new Error('Tool error'));

            await controller.getToolAnalytics(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(500);
        });
    });

    describe('getLLMAnalytics', () => {
        it('deve retornar 200 com analytics de LLMs', async () => {
            const mockData = [{ provider: 'openai', model: 'gpt-4o', totalCalls: 10 }];
            mockReq = { query: {} };
            vi.mocked(mockService.getLLMAnalytics).mockResolvedValueOnce(mockData as any);

            await controller.getLLMAnalytics(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({ success: true, data: mockData });
        });

        it('deve retornar 400 se from for posterior a to', async () => {
            mockReq = { query: { from: '2026-09-10', to: '2026-09-01' } };
            vi.mocked(mockService.getLLMAnalytics).mockRejectedValueOnce(
                new Error('A data inicial (from) não pode ser posterior à data final (to).')
            );

            await controller.getLLMAnalytics(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(400);
        });

        it('deve retornar 500 em erro interno', async () => {
            mockReq = { query: {} };
            vi.mocked(mockService.getLLMAnalytics).mockRejectedValueOnce(new Error('LLM error'));

            await controller.getLLMAnalytics(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(500);
        });
    });
});
