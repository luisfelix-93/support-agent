import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EvaluationWorker, type EvaluationJobData } from './EvaluationWorker.js';
import { Tenant } from '../../domain/Tenant.js';
import { LLMFactory } from '../llm/LLMFactory.js';
import { Worker } from 'bullmq';
import type { ITenantRepository } from '../../domain/ports/ITenantRepository.js';
import type { IEvaluationRepository } from '../../domain/ports/IEvaluationRepository.js';
import type { ILLMProvider } from '../../domain/ports/ILLMProvider.js';

vi.mock('bullmq', () => {
    return {
        Worker: vi.fn().mockImplementation(function (name, processor) {
            return {
                name,
                processor,
                on: vi.fn(),
                close: vi.fn().mockResolvedValue(undefined),
            };
        }),
    };
});

describe('EvaluationWorker', () => {
    let tenantRepository: ITenantRepository;
    let evaluationRepository: IEvaluationRepository;
    let mockLlmProvider: ILLMProvider;
    let worker: EvaluationWorker;

    const sampleJobData: EvaluationJobData = {
        runId: 'run-eval-1',
        tenantId: 'tenant-enterprise',
        workspaceId: 'ws-prod',
        threadId: 'thread-1',
        userMessage: 'Como atualizo minha conta?',
        finalResponse: 'Acesse o menu Configurações > Conta para atualizar seus dados.',
        iterations: 0,
        toolCalls: [],
        totalInputTokens: 100,
        totalOutputTokens: 20,
        totalTokens: 120,
        costUsd: 0.0006,
        durationMs: 1500,
        memoriesInjected: 1,
        contextUtilization: 0.25,
        agentVersion: '1.2.0',
    };

    beforeEach(() => {
        vi.clearAllMocks();

        const tenant = new Tenant(
            'ws-prod',
            { provider: 'google', apiKey: 'fake-api-key', model: 'gemini-2.0-flash' },
            { url: 'http://localhost:3000', apiKey: 'fake-mcp' },
            true
        );

        tenantRepository = {
            findByWorkspaceId: vi.fn().mockResolvedValue(tenant),
            save: vi.fn(),
        };

        evaluationRepository = {
            createIndexes: vi.fn().mockResolvedValue(undefined),
            save: vi.fn().mockResolvedValue(undefined),
            findByRunId: vi.fn(),
            findByTenant: vi.fn(),
            aggregateByVersion: vi.fn(),
            aggregateByTenant: vi.fn(),
        };

        mockLlmProvider = {
            providerName: 'google',
            modelName: 'gemini-2.0-flash',
            generateResponse: vi.fn().mockResolvedValue({
                type: 'text',
                content: JSON.stringify({
                    confidence: 0.95,
                    hallucinationRisk: 0.05,
                    contextRelevance: 0.9,
                    completeness: 1.0,
                    toolSelectionQuality: 1.0,
                    reasoning: 'Resposta precisa e sem alucinações.',
                }),
            }),
        };

        vi.spyOn(LLMFactory, 'create').mockReturnValue(mockLlmProvider);

        worker = new EvaluationWorker(
            {},
            tenantRepository,
            evaluationRepository,
            'agent-evaluation'
        );
    });

    it('deve processar o job com sucesso, calcular scores e persistir EvaluationResult', async () => {
        worker.start();
        const processor = vi.mocked(Worker).mock.calls[0][1] as any;

        await processor({ id: 'job-1', data: sampleJobData });

        expect(tenantRepository.findByWorkspaceId).toHaveBeenCalledWith('ws-prod');
        expect(LLMFactory.create).toHaveBeenCalledWith({
            provider: 'google',
            apiKey: 'fake-api-key',
            model: 'gemini-2.0-flash',
        });
        expect(mockLlmProvider.generateResponse).toHaveBeenCalledTimes(1);

        expect(evaluationRepository.save).toHaveBeenCalledTimes(1);
        const savedResult = vi.mocked(evaluationRepository.save).mock.calls[0][0];

        expect(savedResult.runId).toBe('run-eval-1');
        expect(savedResult.tenantId).toBe('tenant-enterprise');
        expect(savedResult.workspaceId).toBe('ws-prod');
        expect(savedResult.agentVersion).toBe('1.2.0');
        expect(savedResult.selfEval.confidence).toBe(0.95);
        expect(savedResult.selfEval.hallucinationRisk).toBe(0.05);
        expect(savedResult.passive.totalTokens).toBe(120);
        expect(savedResult.passive.costUsd).toBe(0.0006);
        expect(savedResult.passive.durationMs).toBe(1500);
        expect(savedResult.compositeScore).toBeGreaterThan(0.9);
    });

    it('deve pular o processamento se o tenant não for encontrado ou estiver inativo', async () => {
        vi.mocked(tenantRepository.findByWorkspaceId).mockResolvedValueOnce(null);

        worker.start();
        const processor = vi.mocked(Worker).mock.calls[0][1] as any;

        await processor({ id: 'job-skip-1', data: sampleJobData });

        expect(mockLlmProvider.generateResponse).not.toHaveBeenCalled();
        expect(evaluationRepository.save).not.toHaveBeenCalled();
    });

    it('deve realizar retry corretivo caso a primeira resposta do LLM seja um JSON malformado', async () => {
        // Primeira chamada retorna texto não-JSON, segunda chamada retorna JSON válido
        vi.mocked(mockLlmProvider.generateResponse)
            .mockResolvedValueOnce({
                type: 'text',
                content: 'Olá! Avaliação concluída com sucesso mas esqueci do JSON.',
            })
            .mockResolvedValueOnce({
                type: 'text',
                content: JSON.stringify({
                    confidence: 0.85,
                    hallucinationRisk: 0.15,
                    contextRelevance: 0.8,
                    completeness: 0.9,
                    toolSelectionQuality: 0.9,
                    reasoning: 'Corrigido para JSON válido.',
                }),
            });

        worker.start();
        const processor = vi.mocked(Worker).mock.calls[0][1] as any;

        await processor({ id: 'job-retry', data: sampleJobData });

        expect(mockLlmProvider.generateResponse).toHaveBeenCalledTimes(2);
        expect(evaluationRepository.save).toHaveBeenCalledTimes(1);

        const savedResult = vi.mocked(evaluationRepository.save).mock.calls[0][0];
        expect(savedResult.selfEval.confidence).toBe(0.85);
        expect(savedResult.selfEval.hallucinationRisk).toBe(0.15);
    });

    it('deve utilizar scores conservadores de fallback se o LLM falhar ou o retry não retornar JSON', async () => {
        vi.mocked(mockLlmProvider.generateResponse).mockRejectedValue(new Error('LLM Service Unavailable'));

        worker.start();
        const processor = vi.mocked(Worker).mock.calls[0][1] as any;

        await processor({ id: 'job-fallback', data: sampleJobData });

        expect(evaluationRepository.save).toHaveBeenCalledTimes(1);
        const savedResult = vi.mocked(evaluationRepository.save).mock.calls[0][0];

        expect(savedResult.selfEval.confidence).toBe(0.5);
        expect(savedResult.selfEval.hallucinationRisk).toBe(0.5);
        expect(savedResult.selfEval.reasoning).toContain('Fallback: Erro na chamada do modelo de avaliação.');
    });

    it('deve fechar o worker ao chamar stop()', async () => {
        worker.start();
        await worker.stop();

        const mockWorkerInstance = vi.mocked(Worker).mock.results[0].value;
        expect(mockWorkerInstance.close).toHaveBeenCalledTimes(1);
    });
});
